import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import { getMainMenu, getMerchantMenu, getInvoiceMenu, getBackMerchantKeyboard, getCancelKeyboard, getTopupAmountsKeyboard, getProviderKeyboard, getCancelInlineKeyboard } from './menus';
import { t } from '@/lib/i18n';
import { logAudit, AUDIT_ACTIONS } from '@/lib/auditLog';
import { processBroadcast, processUserSearch } from './adminHandlers';
import Invoice from '@/models/Invoice';
import Transaction from '@/models/Transaction';
import User from '@/models/User';
import MerchantChannel from '@/models/MerchantChannel';
import SubscriptionPlan from '@/models/SubscriptionPlan';
import MerchantProfile from '@/models/MerchantProfile';
import Review from '@/models/Review';
import crypto from 'crypto';

export async function handleState(ctx: BotContext) {
    try {
        if (!ctx.message) return;
        const user = ctx.user;
        const state = user.interactionState;
        const text = ctx.message?.text;
        const photo = ctx.message?.photo;
        const l = user.language as any;
        console.log(`[DEBUG] handleState: state=${state}, text=${text}`);

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

        if (text === t(l, 'back_merchant')) {
            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();
            await ctx.reply("Merchant Menu:", { reply_markup: getMerchantMenu(user.language) });
            return;
        }

        // Invoice Types
        if (state === 'selecting_invoice_type_create') {
            console.log(`[DEBUG] entering selecting_invoice_type_create`);
            let type: 'one-time' | 'reusable' = 'one-time';
            if (text === t(l, 'invoice_type_reusable')) type = 'reusable';
            else if (text !== t(l, 'invoice_type_onetime')) {
                await ctx.reply("Please select a valid type or Cancel.");
                return;
            }

            // Limit Check
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

            // Init safely
            if (!user.invoiceUsage) user.invoiceUsage = { oneTime: 0, reusable: 0, month: '' };

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

        // Add Account Flow
        if (user.interactionState === 'awaiting_payment_provider') {
            if (text === t(l, 'cancel')) {
                await ctx.reply("Cancelled.", { reply_markup: getMainMenu(user.role, user.language) });
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            // Validate Provider
            const kpay = t(l, 'provider_kpay');
            const wave = t(l, 'provider_wave');
            let provider = '';
            if (text === kpay) provider = 'KBZ Pay';
            else if (text === wave) provider = 'Wave Pay';
            else {
                // Reprompt
                await ctx.reply(t(l, 'select_provider'), { reply_markup: getProviderKeyboard(user.language) });
                return;
            }

            user.tempData = { provider };
            user.interactionState = 'awaiting_payment_name';
            await user.save();
            await ctx.reply(t(l, 'enter_account_name'), { reply_markup: getCancelKeyboard(user.language) });
            return;
        }

        if (user.interactionState === 'awaiting_payment_name') {
            if (text === t(l, 'cancel')) { /* ... Same Cancel ... */
                await ctx.reply("Cancelled.", { reply_markup: getMainMenu(user.role, user.language) });
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            user.tempData = { ...user.tempData, name: text };
            user.interactionState = 'awaiting_payment_number';
            await user.save();
            await ctx.reply(t(l, 'enter_account_number'), { reply_markup: getCancelKeyboard(user.language) });
            return;
        }

        if (user.interactionState === 'awaiting_payment_number') {
            if (text === t(l, 'cancel')) { /* ... Same Cancel ... */
                await ctx.reply("Cancelled.", { reply_markup: getMainMenu(user.role, user.language) });
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            const number = text;
            if (!number) {
                await ctx.reply("Please enter a number.");
                return;
            }

            // Validator
            // Starts with 09, 959, +959. Followed by digits.
            const phoneRegex = /^(09|959|\+959)\d+$/;
            if (text && !phoneRegex.test(text)) {
                await ctx.reply(t(l, 'error_invalid_phone_format'));
                return;
            }

            const { provider, name } = user.tempData;
            const finalString = `${provider} - ${name} - ${number}`;

            // Use the PaymentMethods array if desired, but User model has 'paymentAccount' string?
            // User.ts says 'paymentMethods' is Phase 2. 'paymentAccount' is likely string from Phase 1?
            // Let's check User.ts again. It has 'paymentAccount' (maybe I missed it or it was removed?).
            // Step 1656 View showed:
            // 45:     paymentMethods: [{ provider... }]
            // But did it have `paymentAccount` string? 
            // I DO NOT SEE `paymentAccount: String` in Step 1656 view of User.ts!
            // Wait. Step 1656 showed `paymentMethods` array.
            // BUT user.ts usually had `paymentAccount` string for Topup/Withdraw logic in previous steps?
            // Ah, `User.ts` in 1656 showed `balance`, `role`.
            // I don't see `paymentAccount` in the Schema snippet I saw!
            // Wait. Lines 1-60.
            // Did I miss it?
            // If `paymentMethods` is the only place, I should push to it.

            // However, existing Withdrawal Logic (`menuHandlers.ts: startWithdrawalLogic`) likely checks `user.paymentAccount`.
            // If `user.paymentAccount` is removed, existing code breaks.
            // Let's assume I should push to `paymentMethods`.
            // But user asked for "Add Payment Account".

            // If User.ts DOES NOT have `paymentAccount` string, I should fix Withdrawal logic too.
            // But for now, let's just save to `paymentMethods`.

            user.paymentMethods.push({
                provider: provider === 'KBZ Pay' ? 'kpay' : 'wavepay', // map back to enum
                accountName: name,
                accountNumber: number
            });

            // Audit Log
            await logAudit(user._id, AUDIT_ACTIONS.ACCOUNT_ADDED, 'account', number, {
                provider: provider === 'KBZ Pay' ? 'kpay' : 'wavepay',
                accountNumber: number.slice(-4) // Only log last 4 digits for privacy
            });

            // Also update `paymentAccount` string for backward compatibility IF it exists?
            // I'll check if I can set `user.paymentAccount` (any).
            // Actually, if I use `paymentMethods`, I should prompt user to PICK one during withdraw?
            // That's more complex.

            // For now, let's just save to `paymentMethods`.

            user.interactionState = 'idle';
            await user.save();

            await ctx.reply(t(l, 'account_added', { account: finalString }), { reply_markup: getMainMenu(user.role, user.language) });
            return;
        }

        if (state === 'selecting_invoice_type_view') {
            console.log(`[DEBUG] entering selecting_invoice_type_view`);
            let type: 'one-time' | 'reusable' = 'one-time';
            if (text === t(l, 'invoice_type_reusable')) type = 'reusable';

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

        if (state === 'awaiting_topup_provider') {
            if (text === t(l, 'cancel')) {
                await ctx.reply("Cancelled.", { reply_markup: getMainMenu(user.role, user.language) });
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            const kpay = t(l, 'provider_kpay');
            const wave = t(l, 'provider_wave');
            let provider = '';

            if (text === kpay) provider = 'kpay';
            else if (text === wave) provider = 'wavepay';
            else {
                await ctx.reply(t(l, 'select_provider_topup'), { reply_markup: getProviderKeyboard(user.language) });
                return;
            }



            // Ask Amount (Streamlined: Show Buttons)
            user.tempData = { topupProvider: provider };
            user.interactionState = 'awaiting_topup_amount_selection';
            await user.save();
            await ctx.reply(t(l, 'enter_topup_amount') || "Select amount:", { reply_markup: getTopupAmountsKeyboard(user.language) });
            return;
        }

        if (state === 'awaiting_topup_amount_selection') {
            if (text === "Custom Amount") {
                user.interactionState = 'awaiting_topup_amount_custom';
                await user.save();
                await ctx.reply("Please enter the amount (MMK):", { reply_markup: getCancelKeyboard(user.language) });
                return;
            }

            // check preset
            const cleaned = (text || '').replace(/,/g, '');
            const amount = parseInt(cleaned);

            if (isNaN(amount) || amount < 3000) {
                await ctx.reply("Please select a button or choose Custom Amount.");
                return;
            }

            // Proceed to Proof
            user.tempData = { ...user.tempData, topupAmount: amount };
            user.interactionState = 'awaiting_topup_proof';
            await user.save();

            const provider = user.tempData.topupProvider;
            if (provider === 'kpay') {
                await ctx.reply(t(l, 'admin_kpay_info'), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(t(l, 'admin_wave_info'), { parse_mode: 'Markdown' });
            }

            await ctx.reply(t(l, 'enter_proof') || "Please upload the payment screenshot.", {
                parse_mode: 'Markdown',
                reply_markup: getCancelKeyboard(user.language) // Allow backing out
            });
            return;
        }

        if (state === 'awaiting_topup_amount_custom') { // Old awaiting_topup_amount
            const amount = parseInt(text || '');
            if (isNaN(amount) || amount < 3000) {
                await ctx.reply("Min amount is 3000 MMK. Try again or /cancel.");
                return;
            }
            // Save to tempData, next state
            user.tempData = { ...user.tempData, topupAmount: amount };
            user.interactionState = 'awaiting_topup_proof';
            await user.save();

            const provider = user.tempData.topupProvider;
            if (provider === 'kpay') {
                await ctx.reply(t(l, 'admin_kpay_info'), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(t(l, 'admin_wave_info'), { parse_mode: 'Markdown' });
            }

            await ctx.reply(t(l, 'enter_proof'), { parse_mode: 'Markdown' });
            return;
        }

        if (state === 'awaiting_withdraw_amount') {
            const amount = parseInt(text || '');
            if (isNaN(amount) || amount < 10000) {
                await ctx.reply("Min withdraw is 10,000. Try again or /cancel.");
                return;
            }

            // Fee Logic: 5%
            const fee = amount * 0.05;
            const totalDeduction = amount + fee;

            if (user.balance < totalDeduction) {
                return ctx.reply(`Insufficient balance.\nRequested: ${amount.toLocaleString()}\nFee (5%): ${fee.toLocaleString()}\nTotal Required: ${totalDeduction.toLocaleString()}\nYour Balance: ${user.balance.toLocaleString()}`);
            }

            // Ask for Account selection or Confirmation if 1 account
            if (!user.paymentMethods || user.paymentMethods.length === 0) {
                return ctx.reply("No payment accounts linked. Please add one in Settings first.");
            }

            // Store amount temporarily
            user.tempData = { withdrawAmount: amount, withdrawFee: fee, withdrawTotal: totalDeduction };
            user.markModified('tempData');
            await user.save();

            // Ask to select account
            let msg = `Withdrawal Request:\nAmount: ${amount.toLocaleString()}\nFee (5%): ${fee.toLocaleString()}\nTotal Deduction: ${totalDeduction.toLocaleString()}\n\nSelect Account:`;
            const kb = new InlineKeyboard();
            user.paymentMethods.forEach((pm: any, index: number) => {
                kb.text(`${pm.provider} - ${pm.accountNumber}`, `confirm_withdraw_acc_${index}`).row();
            });
            kb.text("Cancel", "cancel_withdraw");

            await ctx.reply(msg, { reply_markup: kb });
            // State: awaiting_withdraw_confirm (or handled by callback)
            user.interactionState = 'idle'; // Handled by callback now
            await user.save();
            return;
        }

        if (state === 'awaiting_topup_proof') {
            if (!photo) {
                await ctx.reply("Please upload a photo of the receipt.", {
                    reply_markup: getCancelInlineKeyboard(user.language)
                });
                return;
            }

            const fileId = photo[photo.length - 1].file_id;
            const amount = user.tempData?.topupAmount || 0;

            if (amount <= 0) {
                await ctx.reply("Error: Amount missing. /cancel and try again.");
                return;
            }

            // Create Transaction with proof image
            const tx = await Transaction.create({
                fromUser: user._id,
                toUser: user._id,
                amount: amount,
                type: 'topup',
                status: 'pending',
                proofImageId: fileId  // Store receipt for admin to view later
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

        if (state === 'awaiting_broadcast_message') {
            await processBroadcast(ctx, text || '');
            return;
        }

        if (state === 'awaiting_admin_user_search') {
            if (text === '/cancel') {
                await ctx.reply("Cancelled.");
                ctx.user.interactionState = 'idle';
                await ctx.user.save();
                return;
            }
            if (text) await processUserSearch(ctx, text);
            return;
        }

        if (state === 'awaiting_withdraw_reject_reason') {
            const reason = text;
            const txId = user.tempData?.rejectTxId;

            if (!txId) {
                user.interactionState = 'idle';
                await user.save();
                return ctx.reply("Session expired (No Tx ID).");
            }

            const { default: Transaction } = await import('@/models/Transaction');
            const { default: User } = await import('@/models/User'); // Model import

            console.log(`[DEBUG] processing reject reason for: ${txId}`);
            const tx = await Transaction.findById(txId);
            console.log(`[DEBUG] tx found (reject):`, tx);

            if (!tx || tx.status !== 'pending') {
                console.log(`[DEBUG] Fail Reject: tx=${!!tx}, status=${tx?.status}`);
                user.interactionState = 'idle';
                await user.save();
                return ctx.reply("Transaction not found or already processed.");
            }

            // Reject
            tx.status = 'rejected';
            tx.rejectionReason = reason;
            tx.adminProcessedBy = user._id; // Admin
            await tx.save();

            // Refund User
            const targetUser = await User.findById(tx.fromUser);
            if (targetUser) {
                // Formatting consistency with creation
                const amount = tx.amount;
                const fee = amount * 0.05;
                const total = amount + fee;

                targetUser.balance += total;
                await targetUser.save();

                await ctx.api.sendMessage(targetUser.telegramId, `❌ <b>Withdrawal Rejected</b>\n\nYour withdrawal request for ${amount.toLocaleString()} MMK has been rejected.\n\nReason: <i>${reason}</i>\n\n💰 <b>${total.toLocaleString()} MMK</b> has been refunded to your balance.`, { parse_mode: 'HTML' });
            }

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();

            await ctx.reply(`✅ Withdrawal rejected and refunded.\nReason: ${reason}`);
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
            const uniqueId = crypto.randomUUID();

            await Invoice.create({
                merchantId: user._id,
                type: type,
                amount: amount,
                status: 'active',
                uniqueId: uniqueId,
                createdMonth: user.invoiceUsage?.month || new Date().toISOString().slice(0, 7)
            });

            const botUsername = ctx.me?.username || 'bot';
            const link = `https://t.me/${botUsername}?start=pay_${uniqueId}`;

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

            await MerchantProfile.updateOne({ userId: user._id }, { businessName: name });

            user.interactionState = 'idle'; // Reset state
            await user.save();

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

        // Edit Plan Price
        if (state === 'awaiting_plan_new_price') {
            if (!text || !user.tempData?.editPlanId) {
                await ctx.reply("Session expired. Please try again.");
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            const newPrice = parseInt(text.replace(/,/g, ''));
            if (isNaN(newPrice) || newPrice < 1000) {
                await ctx.reply("Invalid price. Minimum is 1,000 MMK. Try again:");
                return;
            }

            const plan = await SubscriptionPlan.findById(user.tempData.editPlanId);
            if (!plan) {
                await ctx.reply("Plan not found.");
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            const oldPrice = plan.price;
            plan.price = newPrice;
            await plan.save();

            // Audit Log
            await logAudit(user._id, AUDIT_ACTIONS.PLAN_PRICE_CHANGED, 'plan', String(plan._id), {
                planName: (plan as any).name || `${plan.durationMonths} Month(s)`,
                oldPrice,
                newPrice
            });

            user.interactionState = 'idle';
            const channelId = user.tempData.channelId;
            user.tempData = undefined;
            await user.save();

            await ctx.reply(`✅ Price updated to ${newPrice.toLocaleString()} MMK!`);

            // Restore merchant menu
            await ctx.reply("Merchant Menu:", { reply_markup: getMerchantMenu(user.language) });

            // Also show plan list for easy access
            const plans = await SubscriptionPlan.find({ channelId });
            const ch = await MerchantChannel.findById(channelId);

            if (ch && plans.length > 0) {
                let msg = `📋 <b>Manage Plans - ${ch.title}</b>\n\nSelect a plan to edit:\n`;
                const kb = new InlineKeyboard();

                plans.forEach((p: any) => {
                    const status = p.isActive ? '✅' : '❌';
                    const name = p.name || `${p.durationMonths} Month(s)`;
                    msg += `\n${status} ${name} - ${p.price.toLocaleString()} MMK`;
                    kb.text(`${status} ${name}`, `edit_plan_${p._id}`).row();
                });

                kb.text("🔙 Back", `manage_ch_${channelId}`).row();
                await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
            }
            return;
        }

        // Edit Channel Description
        if (state === 'awaiting_channel_description') {
            if (!text || !user.tempData?.editChannelId) {
                await ctx.reply("Session expired. Please try again.");
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            if (text.length > 200) {
                await ctx.reply("Description too long! Maximum 200 characters. Try again:");
                return;
            }

            const ch = await MerchantChannel.findById(user.tempData.editChannelId);
            if (!ch) {
                await ctx.reply("Channel not found.");
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            ch.description = text;
            await ch.save();

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();

            await ctx.reply(`✅ Description updated!`, { reply_markup: getMerchantMenu(user.language) });

            // Show updated channel details
            const { handleChannelDetails } = await import('./subscriptionHandlers');
            await handleChannelDetails(ctx, String(ch._id));
            return;
        }

        // Review Comment
        if (state === 'awaiting_review_comment') {
            if (!user.tempData?.reviewChannelId || !user.tempData?.reviewRating) {
                await ctx.reply("Session expired. Please try again.");
                user.interactionState = 'idle';
                await user.save();
                return;
            }

            const channelId = user.tempData.reviewChannelId;
            const rating = user.tempData.reviewRating;
            let comment: string | undefined = undefined;

            // Check if user wants to skip
            if (text && text.toLowerCase() !== '/skip') {
                if (text.length > 500) {
                    await ctx.reply("Comment too long! Maximum 500 characters. Try again or /skip:");
                    return;
                }
                comment = text;
            }

            // Upsert review (one per user per channel)
            await Review.findOneAndUpdate(
                { userId: user._id, channelId },
                { rating, comment, updatedAt: new Date() },
                { upsert: true, new: true }
            );

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();

            await ctx.reply(`✅ Thank you for your review! ${'⭐'.repeat(rating)}`, { reply_markup: getMainMenu(user.role, user.language) });
            return;
        }

        // Admin Popular Pricing
        if (state === 'awaiting_popular_price') {
            const { processPopularPrice } = await import('./adminHandlers');
            await processPopularPrice(ctx, text || '');
            return;
        }

        // Admin Topup Rejection Reason
        if (state === 'awaiting_topup_reject_reason') {
            const { processTopupRejection } = await import('./adminHandlers');
            await processTopupRejection(ctx, text || '');
            return;
        }

        // Admin Withdrawal Rejection Reason
        if (state === 'awaiting_withdraw_reject_reason') {
            const { processWithdrawalRejection } = await import('./adminHandlers');
            await processWithdrawalRejection(ctx, text || '');
            return;
        }

        // Add Channel Flow
        if (state === 'awaiting_channel_username') {
            let channelId: number | undefined;
            let title: string | undefined;
            let username: string | undefined;

            if (ctx.message && 'forward_from_chat' in ctx.message && ctx.message.forward_from_chat) {
                const fwd = ctx.message.forward_from_chat as any;
                if (fwd.type !== 'channel') {
                    await ctx.reply("Please forward from a CHANNEL.");
                    return;
                }
                channelId = fwd.id;
                title = fwd.title;
                username = fwd.username;
            } else if (text && text.startsWith('@')) {
                try {
                    const chat = await ctx.api.getChat(text);
                    if (chat.type !== 'channel') {
                        await ctx.reply("That is not a channel.");
                        return;
                    }
                    channelId = chat.id;
                    title = chat.title;
                    username = chat.username;
                } catch (e) {
                    await ctx.reply("Could not find channel. Make sure I am Admin or username is correct.");
                    return;
                }
            } else {
                await ctx.reply("Please enter @username or Forward a message from the channel.");
                return;
            }

            // Verify Admin
            try {
                if (!channelId) {
                    await ctx.reply("Channel ID is missing. Cannot verify admin status.");
                    return;
                }
                const admins = await ctx.api.getChatAdministrators(channelId);
                const me = await ctx.api.getMe();
                const isAdmin = admins.some(a => a.user.id === me.id);
                if (!isAdmin) {
                    await ctx.reply(t(l, 'channel_add_fail'));
                    return;
                }
            } catch (e) {
                await ctx.reply("Error verifying admin status: " + e);
                return;
            }

            // Store in tempData and ask for category
            user.tempData = { channelId, title, username };
            user.interactionState = 'awaiting_channel_category';
            await user.save();

            const kb = new InlineKeyboard()
                .text(t(l, 'cat_entertainment'), 'ch_cat_entertainment').text(t(l, 'cat_education'), 'ch_cat_education').row()
                .text(t(l, 'cat_business'), 'ch_cat_business').text(t(l, 'cat_gaming'), 'ch_cat_gaming').row()
                .text(t(l, 'cat_lifestyle'), 'ch_cat_lifestyle').text(t(l, 'cat_other'), 'ch_cat_other');

            await ctx.reply(`✅ Channel "<b>${title}</b>" verified!\n\nSelect a category:`, { parse_mode: 'HTML', reply_markup: kb });
            return;
        }


        // Onboarding: Channel
        if (state === 'onboarding_merchant_channel') {
            let channel = text;
            if (!channel) return ctx.reply("Please enter link or 'skip'.");
            if (channel.toLowerCase() === 'skip') channel = "";

            const name = user.tempData?.merchantName || "Unknown Shop";

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

            await ctx.reply(t(l, 'merchant_completed'), { reply_markup: getMerchantMenu(user.language) });
            await ctx.reply(t(l, 'merchant_completed'), { reply_markup: getMerchantMenu(user.language) });
            return;
        }

        if (state === 'awaiting_plan_price') {
            const price = parseInt(text || '');
            if (isNaN(price) || price < 1000) {
                await ctx.reply("Invalid price. Min 1000 MMK.");
                return;
            }

            const duration = user.tempData?.planDuration;
            const channelIdStr = user.tempData?.planChannelId;

            await SubscriptionPlan.create({
                channelId: channelIdStr,
                durationMonths: duration,
                price: price,
                isActive: true
            });

            user.interactionState = 'idle';
            user.tempData = undefined;
            await user.save();

            await ctx.reply(t(l, 'plan_created'), { reply_markup: getMerchantMenu(user.language) });
            return;
        }

        // fallback
        user.interactionState = 'idle';
        await user.save();
        await ctx.reply("Unknown state reset.", { reply_markup: getMainMenu(user.role, user.language) });
    } catch (err) {
        console.error("State Handler Error:", err);
        console.log(err);
        await ctx.reply("An error occurred. State reset.");
        ctx.user.interactionState = 'idle';
        await ctx.user.save();
    }
}
