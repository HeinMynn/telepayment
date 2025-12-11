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

    // format: pay_MERCHANTID_AMOUNT (in cents)
    const parts = payload.replace('pay_', '').split('_');
    const merchantTelegramId = parseInt(parts[0]);
    const amount = parseInt(parts[1]);

    if (isNaN(merchantTelegramId) || isNaN(amount)) {
        return ctx.reply("Invalid invoice link format.");
    }

    // Check merchant
    const merchant = await User.findOne({ telegramId: merchantTelegramId });
    if (!merchant) return ctx.reply("Merchant not found.");

    const amountDisplay = (amount / 100).toFixed(2);

    const warning = t(ctx.user.language as any, 'pay_warning')
        .replace('[Merchant Name]', `User ${merchantTelegramId}`)
        .replace('[Merchant Name]', merchant.role === 'merchant' ? 'Registered Merchant' : `User ${merchantTelegramId}`) // Simple override
        .replace('[Amount]', amountDisplay);

    const keyboard = new InlineKeyboard()
        .text(t(ctx.user.language as any, 'pay_cancel'), 'cancel_payment')
        .text(t(ctx.user.language as any, 'pay_confirm'), `confirm_pay_${merchantTelegramId}_${amount}`);

    await ctx.reply(`Invoice: $${amountDisplay}\nTo: ${merchantTelegramId}\n\n` + warning, { reply_markup: keyboard });
}

export function initPaymentHandlers() {
    bot.callbackQuery(/^confirm_pay_(\d+)_(\d+)$/, async (ctx) => {
        const match = ctx.match as RegExpMatchArray;
        const merchantId = parseInt(match[1]);
        const amount = parseInt(match[2]);

        // Atomic Transaction
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const sender = await User.findById(ctx.user._id).session(session);
            const receiver = await User.findOne({ telegramId: merchantId }).session(session);

            if (!sender || !receiver) throw new Error("User not found");

            if (sender.balance < amount) {
                await ctx.answerCallbackQuery({ text: t(sender.language as any, 'insufficient_funds'), show_alert: true });
                await session.abortTransaction();
                return;
            }

            sender.balance -= amount;
            receiver.balance += amount;

            await sender.save();
            await receiver.save();

            await Transaction.create([{
                fromUser: sender._id,
                toUser: receiver._id,
                amount,
                status: 'completed',
                snapshotBalanceBefore: sender.balance + amount, // Reconstruct balance before
                snapshotBalanceAfter: sender.balance
            }], { session });

            await session.commitTransaction();

            await ctx.answerCallbackQuery({ text: t(sender.language as any, 'payment_success') });
            await ctx.editMessageText(t(sender.language as any, 'payment_success'));

            // Notify receiver
            try {
                await bot.api.sendMessage(receiver.telegramId, `Received $${(amount / 100).toFixed(2)} from ${sender.telegramId}`);
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
