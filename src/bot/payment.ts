import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import { t } from '@/lib/i18n';
import Transaction from '@/models/Transaction';
import User from '@/models/User';
import mongoose from 'mongoose';
import { bot } from './bot';

export async function handlePaymentStart(ctx: BotContext, payload: string) {
    if (!ctx.user.termsAccepted) {
        return ctx.reply(t(ctx.user.language as any, 'tos_rejected'));
    }

    // format: pay_UNIQUEID
    const uniqueId = payload.replace('pay_', '');

    // Find Invoice
    const { default: Invoice } = await import('@/models/Invoice');
    const invoice = await Invoice.findOne({ uniqueId });

    if (!invoice) return ctx.reply("Invoice not found.");
    if (invoice.status !== 'active') return ctx.reply(`Invoice is ${invoice.status}.`);

    // Check Merchant
    const merchant = await User.findById(invoice.merchantId);
    if (!merchant) return ctx.reply("Merchant not found.");

    // Prevent Paying Self
    if (String(merchant._id) === String(ctx.user._id)) return ctx.reply("You cannot pay yourself.");

    const amountDisplay = invoice.amount.toLocaleString();

    // Fetch Name
    let merchantName = `User ${merchant.telegramId}`;
    let showRealName = true;

    if (merchant.role === 'merchant') {
        const { default: MerchantProfile } = await import('@/models/MerchantProfile');
        const profile = await MerchantProfile.findOne({ userId: merchant._id });
        if (profile && profile.businessName && profile.businessName !== 'Pending Setup') {
            merchantName = profile.businessName;
            showRealName = false;
        }
    }

    if (showRealName) {
        // Try to show User Name
        if (merchant.firstName) {
            merchantName = `${merchant.firstName} ${merchant.lastName || ''}`.trim();
        } else if (merchant.username) {
            merchantName = `@${merchant.username}`;
        }
    }

    // Keyboard with InvoiceID
    const keyboard = new InlineKeyboard()
        .text(t(ctx.user.language as any, 'pay_cancel'), 'cancel_payment')
        .text(t(ctx.user.language as any, 'pay_confirm'), `confirm_pay_${invoice._id}`); // Pass ID

    const warning = t(ctx.user.language as any, 'pay_warning').replace('[Merchant Name]', merchantName);

    await ctx.reply(`🧾 <b>Invoice Payment</b>\n\nAmount: ${amountDisplay} MMK\nTo: ${merchantName}\n\n${warning}`, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
    });
}

export function initPaymentHandlers() {
    bot.callbackQuery(/^confirm_pay_(.+)$/, async (ctx) => { // Capture ID
        const invoiceId = ctx.match[1];

        // Atomic Transaction
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const sender = await User.findById(ctx.user._id).session(session);
            const { default: Invoice } = await import('@/models/Invoice');
            const invoice = await Invoice.findById(invoiceId).session(session);

            if (!invoice) throw new Error("Invoice missing");
            if (invoice.status !== 'active') {
                await ctx.answerCallbackQuery({ text: "Invoice expired/revoked", show_alert: true });
                await session.abortTransaction();
                return;
            }

            const receiver = await User.findById(invoice.merchantId).session(session);

            if (!sender || !receiver) throw new Error("User not found");

            if (sender.balance < invoice.amount) {
                await session.abortTransaction();
                await ctx.answerCallbackQuery(); // No alert

                // Prompt Top Up
                const { InlineKeyboard } = await import('grammy');
                const kb = new InlineKeyboard().text("➕ Top Up", "start_topup_flow");
                await ctx.reply("Insufficient funds. Please top up to continue.", { reply_markup: kb });
                return;
            }

            sender.balance -= invoice.amount;
            receiver.balance += invoice.amount;

            // Handle One-Time Invoice
            if (invoice.type === 'one-time') {
                invoice.status = 'completed';
            }
            invoice.usageCount += 1;
            await invoice.save({ session });

            await sender.save({ session });
            await receiver.save({ session });

            await Transaction.create([{
                fromUser: sender._id,
                toUser: receiver._id,
                amount: invoice.amount,
                invoiceId: invoice._id,
                status: 'completed',
                type: 'payment',
                snapshotBalanceBefore: sender.balance + invoice.amount,
                snapshotBalanceAfter: sender.balance
            }], { session });

            await session.commitTransaction();

            await ctx.answerCallbackQuery({ text: t(sender.language as any, 'payment_success') });
            await ctx.editMessageText(t(sender.language as any, 'payment_success'));

            // Notify receiver
            try {
                await bot.api.sendMessage(receiver.telegramId, `Received ${invoice.amount.toLocaleString()} MMK from ${sender.telegramId} (Ref: ${invoice.uniqueId})`);
            } catch (notifyError) {
                console.error("Failed to notify receiver:", notifyError);
            }

        } catch (e) {
            await session.abortTransaction();
            console.error("Payment Error:", e);
            await ctx.answerCallbackQuery({ text: t(ctx.user.language as any, 'payment_failed'), show_alert: true });
        } finally {
            session.endSession();
        }
    });

    bot.callbackQuery('cancel_payment', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("Payment Cancelled.");
    });
}
