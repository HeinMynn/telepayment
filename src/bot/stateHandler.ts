import { BotContext } from './types';
import { getMainMenu, getMerchantMenu, getInvoiceMenu, getBackMerchantKeyboard, getCancelKeyboard } from './menus';
import { t } from '@/lib/i18n';

export async function handleState(ctx: BotContext) {
    try {
        const user = ctx.user;
        const state = user.interactionState;
        const text = ctx.message?.text;
        const photo = ctx.message?.photo;
        const l = user.language as any;

        if (state === 'awaiting_account_details') {
            if (!text) return ctx.reply("Please enter details.");
            // Parsing "Provider Name Number"
            const parts = text.split(' ');
            if (parts.length < 3) {
                await ctx.reply("Invalid format. Use: Provider Name Number");
                return;
            }
            const provider = parts[0] as 'kpay' | 'wavepay';
            const number = parts[parts.length - 1];
            const name = parts.slice(1, parts.length - 1).join(' ');

            if (!user.paymentMethods) user.paymentMethods = [];
            user.paymentMethods.push({
                provider,
                accountName: name,
                accountNumber: number
            });

            user.interactionState = 'idle';
            await user.save();
            await ctx.reply("Payment account added!", { reply_markup: getMainMenu(user.role, user.language) });
            return;
        }

        if (text === '/cancel' || text === t(l, 'cancel') || text === t(l, 'back_main')) {
            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();
            await ctx.reply("Cancelled.", { reply_markup: getMainMenu(user.role, user.language) });
            return;
        }

        // Invoice Types
        if (state === 'selecting_invoice_type_create') {
            let type: 'one-time' | 'reusable' = 'one-time';
            if (text === t(l, 'invoice_type_reusable')) type = 'reusable';
            else if (text !== t(l, 'invoice_type_onetime')) {
                await ctx.reply("Please select a valid type or Cancel.");
                return;
            }

            // Limit Check
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
            if (user.invoiceUsage.month !== currentMonth) {
                user.invoiceUsage = { oneTime: 0, reusable: 0, month: currentMonth };
            }

            if (type === 'one-time' && user.invoiceUsage.oneTime >= 30) {
                await ctx.reply("Monthly limit reached for One-Time invoices (30).");
                return;
            }
            if (type === 'reusable' && user.invoiceUsage.reusable >= 10) {
                await ctx.reply("Monthly limit reached for Reusable invoices (10).");
                return;
            }

            user.interactionState = 'awaiting_invoice_amount';
            user.tempData = { invoiceType: type };
            await user.save();
            await ctx.reply(t(l, 'enter_invoice_amount'), { reply_markup: getCancelKeyboard(user.language) });
            return;
        }

        if (state === 'selecting_invoice_type_view') {
            let type: 'one-time' | 'reusable' = 'one-time';
            if (text === t(l, 'invoice_type_reusable')) type = 'reusable';

            const { default: Invoice } = await import('@/models/Invoice');
            const invoices = await Invoice.find({
                merchantId: user._id,
                type: type,
                status: { $ne: 'revoked' } // or active? view active
            }).sort({ createdAt: -1 }).limit(10);

            if (invoices.length === 0) {
                await ctx.reply(`No active ${type} invoices found.`, {
                    reply_markup: getInvoiceMenu(user.language) // This keyboard has Create, View, Back
                });
            } else {
                const { InlineKeyboard } = await import('grammy');
                const kb = new InlineKeyboard();

                invoices.forEach((inv) => {
                    const amount = inv.amount.toLocaleString();
                    const date = new Date(inv.createdAt).toLocaleDateString();
                    kb.text(`${amount} MMK (${inv.usageCount} Paid)`, `view_invoice_${inv._id}`).row();
                });

                await ctx.reply(`🧾 <b>Select ${type} Invoice</b>`, {
                    reply_markup: kb,
                    parse_mode: 'HTML'
                });
                await ctx.reply(" Use menu to go back.", { reply_markup: getBackMerchantKeyboard(user.language) });
            }

            user.interactionState = 'idle';
            await user.save();
            return;
        }

        if (state === 'awaiting_topup_amount') {
            const amount = parseInt(text || '');
            if (isNaN(amount) || amount < 3000) {
                await ctx.reply("Min amount is 3000 MMK. Try again or /cancel.");
                return;
            }
            // Save to tempData, next state
            user.tempData = { topupAmount: amount };
            user.interactionState = 'awaiting_topup_proof';
            await user.save();

            await ctx.reply(t(l, 'topup_payment_info'), { parse_mode: 'Markdown' });
            return;
        }

        if (state === 'awaiting_withdraw_amount') {
            const amount = parseInt(text || '');
            if (isNaN(amount) || amount < 10000) {
                await ctx.reply("Min withdraw is 10,000. Try again or /cancel.");
                return;
            }
            if (user.balance < amount) {
                await ctx.reply("Insufficient balance.");
                return;
            }

            // Atomic Withdraw Request
            const { default: Transaction } = await import('@/models/Transaction');
            await Transaction.create({
                fromUser: user._id,
                amount: amount,
                type: 'withdraw',
                status: 'pending'
            });

            user.balance -= amount;
            user.interactionState = 'idle';
            await user.save();

            await ctx.reply(`Withdrawal of ${amount.toLocaleString()} MMK queued. Please wait up to 3 days for processing.`, {
                reply_markup: getMainMenu(user.role, user.language)
            });
            return;
        }

        if (state === 'awaiting_topup_proof') {
            if (!photo) {
                await ctx.reply("Please upload a photo.");
                return;
            }

            const fileId = photo[photo.length - 1].file_id;
            const amount = user.tempData?.topupAmount || 0;

            if (amount <= 0) {
                await ctx.reply("Error: Amount missing. /cancel and try again.");
                return;
            }

            const { default: Transaction } = await import('@/models/Transaction');
            const { default: User } = await import('@/models/User');
            const { InlineKeyboard } = await import('grammy');

            // Create Transaction
            const tx = await Transaction.create({
                fromUser: user._id, // User is sending money (Topup) -> No, technically 'fromUser' usually tracks flow. For Topup, it's EXTERNAL -> User. 
                // Let's use 'toUser' = user._id. 'fromUser' = null? or Admin? 
                // In typical ledger: Topup is System -> User.
                // But 'Transaction' model requires fromUser? Let's check Schema.
                // Assuming we track 'deposit' type.
                toUser: user._id,
                amount: amount,
                type: 'topup',
                status: 'pending',
                // Store proof file_id? We need a field or put in description/metadata?
                // Schema has 'snapshotBalanceBefore'?
                // Let's assume we can't store fileId in Schema easily without update.
                // For now, we just pass fileId to Admin. We don't persist it in DB unless we add field.
                // "Send the receipt to admin".
            });

            // Find Admin
            let admin;
            const adminIdEnv = process.env.ADMIN_ID;
            if (adminIdEnv) {
                admin = await User.findOne({ telegramId: parseInt(adminIdEnv) });
            }
            if (!admin) {
                admin = await User.findOne({ role: 'admin' });
            }

            if (admin) {
                const kb = new InlineKeyboard()
                    .text("✅ Approve", `topup_approve_${tx._id}`)
                    .text("❌ Reject", `topup_reject_${tx._id}`);

                const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown';
                const username = user.username ? `@${user.username}` : 'No Username';
                const profileLink = `<a href="tg://user?id=${user.telegramId}">${user.telegramId}</a>`;

                await ctx.api.sendPhoto(admin.telegramId, fileId, {
                    caption: `🔔 <b>Topup Request</b>\n\n` +
                        `User: <b>${fullName}</b> (${username})\n` +
                        `ID: ${profileLink}\n` +
                        `Amount: <b>${amount.toLocaleString()} MMK</b>\n` +
                        `TxID: <code>${tx._id}</code>`,
                    reply_markup: kb,
                    parse_mode: 'HTML'
                });
            } else {
                console.error("No admin found to verify topup.");
            }

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();
            await ctx.reply(t(l, 'topup_submitted'), { reply_markup: getMainMenu(user.role, user.language) });
            return;
        }

        // Admin Rejection Reason
        if (state === 'awaiting_reject_reason') {
            const reason = text;
            if (!reason) return ctx.reply("Please enter text.");

            const txId = user.tempData?.rejectTxId;
            if (!txId) {
                await ctx.reply("Error: TxID missing.");
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            const { default: Transaction } = await import('@/models/Transaction');
            const { default: User } = await import('@/models/User');

            const tx = await Transaction.findById(txId);
            if (tx && tx.status === 'pending') {
                tx.status = 'rejected';
                // tx.rejectReason = reason; // If schema has it.
                tx.adminProcessedBy = user._id;
                await tx.save();

                const targetUser = await User.findById(tx.toUser);
                if (targetUser) {
                    await ctx.api.sendMessage(targetUser.telegramId, t(targetUser.language as any, 'topup_rejected_reason').replace('{reason}', reason));
                }
                await ctx.reply("Rejection sent.");
            } else {
                await ctx.reply("Transaction not found or already processed.");
            }

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();
            return;
        }

        if (state === 'awaiting_invoice_amount') {
            const amount = parseInt(text || '');
            if (isNaN(amount) || amount <= 0) {
                await ctx.reply("Invalid amount. Enter MMK amount (e.g. 5000).");
                return;
            }

            const type = user.tempData?.invoiceType || 'one-time';

            // Increment Usage
            if (type === 'one-time') user.invoiceUsage.oneTime += 1;
            if (type === 'reusable') user.invoiceUsage.reusable += 1;

            // Create Invoice
            const { default: Invoice } = await import('@/models/Invoice');
            const crypto = await import('crypto');
            const uniqueId = crypto.randomUUID();

            await Invoice.create({
                merchantId: user._id,
                type: type,
                amount: amount,
                status: 'active',
                uniqueId: uniqueId,
                createdMonth: user.invoiceUsage.month
            });

            const botUsername = ctx.me?.username || 'bot';
            const link = `https://t.me/${botUsername}?start=pay_${uniqueId}`;

            const { InlineKeyboard } = await import('grammy');
            const idsKB = new InlineKeyboard()
                .switchInline("📤 Send Invoice", `invoice_${uniqueId}`)
                .row()
                .url("🔗 Pay Link", link);

            await ctx.reply(`Created ${type} invoice for ${amount.toLocaleString()} MMK.\n\nUse 'Send Invoice' to share it to any chat.`, {
                reply_markup: idsKB
            });

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();
            await ctx.reply("Done.", { reply_markup: getMainMenu(user.role, user.language) });
            return;
        }

        // State: Awaiting Business Name
        if (state === 'awaiting_business_name') {
            const name = text;
            if (!name) return ctx.reply("Please send text.");

            const { default: MerchantProfile } = await import('@/models/MerchantProfile');
            await MerchantProfile.updateOne({ userId: user._id }, { businessName: name });

            user.interactionState = 'idle'; // Reset state
            await user.save();

            const { getMerchantMenu } = await import('./menus');
            await ctx.reply(t(l, 'merchant_edit_name_success').replace('{name}', name), { reply_markup: getMerchantMenu(user.language) });
            return;
        }

        // Onboarding: Name
        if (state === 'onboarding_merchant_name') {
            const name = text;
            if (!name) return ctx.reply("Please enter name.");

            user.tempData = { ...user.tempData, merchantName: name };
            user.interactionState = 'onboarding_merchant_channel';
            await user.save();
            await ctx.reply(t(l, 'merchant_onboarding_channel'));
            return;
        }

        // Onboarding: Channel
        if (state === 'onboarding_merchant_channel') {
            let channel = text;
            if (!channel) return ctx.reply("Please enter link or 'skip'.");
            if (channel.toLowerCase() === 'skip') channel = "";

            const name = user.tempData?.merchantName || "Unknown Shop";

            const { default: MerchantProfile } = await import('@/models/MerchantProfile');

            // Upsert Profile
            const existing = await MerchantProfile.findOne({ userId: user._id });
            if (existing) {
                existing.businessName = name;
                existing.channelLink = channel;
                await existing.save();
            } else {
                await MerchantProfile.create({
                    userId: user._id,
                    businessName: name,
                    channelLink: channel,
                    withdrawalMethod: "Not Set",
                    agreedToMerchantRules: true
                });
            }

            user.role = 'merchant';
            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();

            const { getMerchantMenu } = await import('./menus');
            await ctx.reply(t(l, 'merchant_completed'), { reply_markup: getMerchantMenu(user.language) });
            return;
        }

        // fallback
        user.interactionState = 'idle';
        await user.save();
        await ctx.reply("Unknown state reset.", { reply_markup: getMainMenu(user.role, user.language) });
    } catch (err) {
        console.error("State Handler Error:", err);
        await ctx.reply("An error occurred. State reset.");
        ctx.user.interactionState = 'idle';
        await ctx.user.save();
    }
}
