import { bot } from './bot';

// Import Handlers
import './chatMemberHandler';
import { t } from '@/lib/i18n';
import User from '@/models/User';
import MerchantProfile from '@/models/MerchantProfile';
import Transaction from '@/models/Transaction';
import { InlineKeyboard } from 'grammy';
import { handlePaymentStart, initPaymentHandlers } from './payment';

// Initialize payment listeners
initPaymentHandlers();

// Initialize payment listeners
initPaymentHandlers();

// Error Handling Middleware for answerCallbackQuery
bot.use(async (ctx, next) => {
    const originalAnswer = ctx.answerCallbackQuery;
    ctx.answerCallbackQuery = async (...args) => {
        try {
            return await originalAnswer.call(ctx, ...args);
        } catch (e: any) {
            console.warn("Suppressing answerCallbackQuery error:", e.message);
            return true;
        }
    };
    await next();
});

// Onboarding / Start
bot.command('start', async (ctx) => {
    const payload = ctx.match; // Deep link payload
    const user = ctx.user;
    console.log('/start called by:', user.telegramId);

    if (payload && (payload.startsWith('pay_') || payload.startsWith('sub_'))) {
        if (!user.termsAccepted) {
            // Defer
            user.tempData = { deferredPayload: payload };
            await user.save();
            // Fall through to ToS check
        } else if (payload.startsWith('sub_')) {
            const { handleSubscriptionStart } = await import('./subscriptionHandlers'); // Fixed import
            return handleSubscriptionStart(ctx, payload);
        } else {
            return handlePaymentStart(ctx, payload);
        }
    }
    if (!user.termsAccepted) {
        const keyboard = new InlineKeyboard().text(t(user.language as any, 'tos_agree'), 'accept_tos');
        await ctx.reply(t(user.language as any, 'welcome') + "\n\n" + t(user.language as any, 'tos_text'), { reply_markup: keyboard });
    } else {
        // Send Main Menu
        const { getMainMenu } = await import('./menus');
        await ctx.reply(t(user.language as any, 'welcome'), { reply_markup: getMainMenu(user.role, user.language) });
    }
});

// Terms Acceptance
bot.callbackQuery('accept_tos', async (ctx) => {
    // ... logic
});

// Handle Renew (Callback)
bot.on('callback_query:data', async (ctx, next) => {
    if (ctx.callbackQuery.data.startsWith('renew_sub_')) {
        const { handleSubscriptionStart } = await import('./subscription');
        // adapt renew_sub_ID -> sub_ID
        const payload = ctx.callbackQuery.data.replace('renew_', '');
        return handleSubscriptionStart(ctx, payload);
    }
    await next();
});

// Terms Acceptance
bot.callbackQuery('accept_tos', async (ctx) => {
    const user = ctx.user;
    if (user.termsAccepted) return ctx.answerCallbackQuery();

    user.termsAccepted = true;
    user.termsAcceptedAt = new Date();
    await user.save();

    await ctx.answerCallbackQuery({ text: "Agreed!" });

    // Check deferred payload
    if (user.tempData && user.tempData.deferredPayload) {
        const payload = user.tempData.deferredPayload;
        // Clear
        user.tempData = undefined;
        await user.save();

        await ctx.editMessageText(t(user.language as any, 'welcome') + "\n\n✅ Terms Accepted.");

        await ctx.editMessageText(t(user.language as any, 'welcome') + "\n\n✅ Terms Accepted.");

        if (payload.startsWith('sub_')) {
            const { handleSubscriptionStart } = await import('./subscription');
            return handleSubscriptionStart(ctx, payload);
        } else {
            const { handlePaymentStart } = await import('./payment');
            return handlePaymentStart(ctx, payload);
        }
    }

    // Send Main Menu
    const { getMainMenu } = await import('./menus');
    await ctx.editMessageText(t(user.language as any, 'welcome')); // Edit previous message
    await ctx.reply("Main Menu:", { reply_markup: getMainMenu(user.role, user.language) });
});

// Merchant Registration
bot.command('become_merchant', async (ctx) => {
    const user = ctx.user;
    if (user.role === 'merchant') {
        return ctx.reply(t(user.language as any, 'merchant_success'));
    }

    const keyboard = new InlineKeyboard().text(t(user.language as any, 'merchant_agree'), 'accept_merchant_rules');
    await ctx.reply(t(user.language as any, 'merchant_rules'), { reply_markup: keyboard });
});

bot.callbackQuery('accept_merchant_rules', async (ctx) => {
    const user = ctx.user;

    // Start Onboarding Chain
    user.interactionState = 'onboarding_merchant_name';
    await user.save();

    await ctx.answerCallbackQuery({ text: "Agreed!" });
    await ctx.reply(t(user.language as any, 'merchant_onboarding_name'));
});

// Invoice Generation
bot.command('invoice', async (ctx) => {
    const user = ctx.user;
    if (user.role !== 'merchant') {
        return ctx.reply("Only merchants can generate invoices. Use /become_merchant.");
    }

    const amountRaw = ctx.match; // "500"
    const amount = parseInt(amountRaw);

    if (!amount || isNaN(amount)) {
        return ctx.reply("Usage: /invoice [amount_mmk]\nExample: /invoice 5000");
    }

    if (!ctx.me?.username) {
        return ctx.reply("Bot username not available.");
    }
    const botUsername = ctx.me.username;
    const link = `https://t.me/${botUsername}?start=pay_${user.telegramId}_${amount}`;
    const amountDisplay = amount.toLocaleString();

    const keyboard = new InlineKeyboard()
        .url(`💸 Pay ${amountDisplay} MMK`, link);

    await ctx.reply(`🧾 <b>Invoice</b>\n\nAmount: ${amountDisplay} MMK\nMerchant: ${user.telegramId}\n\nForward this message to receive payment.`, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
    });
});

// Admin Tools
bot.command('freeze', async (ctx) => {
    if (ctx.user.role !== 'admin') return;

    const targetIdStr = ctx.match;
    const targetId = parseInt(targetIdStr);
    if (isNaN(targetId)) return ctx.reply("Usage: /freeze [telegramId]");

    const target = await User.findOne({ telegramId: targetId });
    if (target) {
        target.isFrozen = true;
        await target.save();
        ctx.reply(`User ${targetId} frozen.`);
    } else {
        ctx.reply("User not found.");
    }
});

bot.command('audit', async (ctx) => {
    if (ctx.user.role !== 'admin') return;

    const targetIdStr = ctx.match;
    const targetId = parseInt(targetIdStr);
    if (isNaN(targetId)) return ctx.reply("Usage: /audit [telegramId]");

    const target = await User.findOne({ telegramId: targetId });
    if (!target) return ctx.reply("User not found.");

    const txs = await Transaction.find({
        $or: [{ fromUser: target._id }, { toUser: target._id }]
    }).sort({ createdAt: -1 }).limit(5);

    if (txs.length === 0) return ctx.reply("No transactions found.");

    let report = `Audit Report for ${targetId}:\n`;
    txs.forEach(tx => {
        report += `\nID: ${tx._id}\nType: ${String(tx.fromUser) === String(target._id) ? 'SENT' : 'RECEIVED'}\nAmount: ${tx.amount}\nStatus: ${tx.status}\nDate: ${tx.createdAt}`;
    });

    ctx.reply(report);
});



// Channel Management Callbacks
bot.callbackQuery('add_channel_start', async (ctx) => {
    const user = ctx.user;
    const { getCancelKeyboard } = await import('./menus');
    const { t } = await import('@/lib/i18n');

    user.interactionState = 'awaiting_channel_username';
    await user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply(t(user.language as any, 'channel_add_prompt'), { reply_markup: getCancelKeyboard(user.language) });
});

bot.callbackQuery(/^manage_channel_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    // Show Plan Management Menu
    // We need to implement this in `subscription.ts` or here?
    const { handleManageChannel } = await import('./subscription');
    await ctx.answerCallbackQuery();
    await handleManageChannel(ctx, channelId);
});

bot.callbackQuery(/^add_plan_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const { handleAddPlan } = await import('./subscription');
    await ctx.answerCallbackQuery();
    await handleAddPlan(ctx, channelId);
});

bot.callbackQuery(/^plan_dur_(\d+)_(.+)$/, async (ctx) => {
    // 1 = Duration, 2 = ChannelId
    const duration = parseInt(ctx.match[1]);
    const channelId = ctx.match[2];

    // Set State
    ctx.user.interactionState = 'awaiting_plan_price';
    ctx.user.tempData = { planDuration: duration, planChannelId: channelId };
    await ctx.user.save();

    const { t } = await import('@/lib/i18n');
    const { getCancelKeyboard } = await import('./menus');

    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx.user.language as any, 'plan_price_prompt'), { reply_markup: getCancelKeyboard(ctx.user.language) });
});

bot.callbackQuery(/^buy_plan_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    const { handleBuyPlan } = await import('./subscription');
    await ctx.answerCallbackQuery();
    await handleBuyPlan(ctx, planId);
});

// Confirm Withdraw Logic
bot.on('callback_query:data', async (ctx, next) => {
    if (ctx.callbackQuery.data.startsWith('confirm_withdraw_acc_')) {
        const indexStr = ctx.callbackQuery.data.replace('confirm_withdraw_acc_', '');
        const index = parseInt(indexStr);
        const user = ctx.user;

        console.log(`[DEBUG] Withdraw Confirm: User ${user.telegramId}, TempData:`, user.tempData);

        if (!user.tempData || !user.tempData.withdrawAmount) {
            console.log("[DEBUG] Session Expired: Missing withdrawAmount");
            return ctx.answerCallbackQuery({ text: "Session expired. Please try again." });
        }

        const amount = user.tempData.withdrawAmount;
        const fee = user.tempData.withdrawFee || (amount * 0.05);
        const total = user.tempData.withdrawTotal || (amount + fee);

        if (user.balance < total) return ctx.answerCallbackQuery({ text: "Insufficient balance.", show_alert: true });

        const account = user.paymentMethods[index];
        if (!account) return ctx.answerCallbackQuery({ text: "Invalid account." });

        // Execute Withdraw
        user.balance -= total;
        user.interactionState = 'idle';
        user.tempData = undefined; // Clear temp data
        await user.save();

        const { default: Transaction } = await import('@/models/Transaction');
        const { default: Subscription } = await import('@/models/Subscription');

        // Create Transaction
        const tx = await Transaction.create({
            fromUser: user._id,
            toUser: user._id, // Self withdraw
            amount: amount, // Requested Amount
            type: 'withdraw',
            status: 'pending',
            description: `Withdraw: ${amount}, Fee: ${fee}. To: ${account.provider} (${account.accountNumber})`
        });

        await ctx.editMessageText(`✅ <b>Withdrawal Requested!</b>\n\nAmount: ${amount.toLocaleString()}\nFee (5%): ${fee.toLocaleString()}\nTotal Deducted: ${total.toLocaleString()}\nAccount: ${account.provider} - ${account.accountNumber}\n\nOur admin will process it shortly.`, { parse_mode: 'HTML' });

        // Notify Admin
        const adminId = process.env.ADMIN_ID;
        if (adminId) {
            try {
                // Aggregations for Report
                // Income
                const incomeStats = await Transaction.aggregate([
                    { $match: { toUser: user._id, type: { $in: ['payment', 'subscription'] }, status: 'completed' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const income = incomeStats[0]?.total || 0;

                // Topups
                const topupStats = await Transaction.aggregate([
                    { $match: { toUser: user._id, type: 'topup', status: 'completed' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const topup = topupStats[0]?.total || 0;

                // Usage (Spending)
                const usageStats = await Transaction.aggregate([
                    { $match: { fromUser: user._id, type: { $in: ['payment', 'subscription'] }, status: 'completed' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const usage = usageStats[0]?.total || 0;

                let report = `🔔 **New Withdrawal Request**\n\n`;
                report += `User: <b>${user.firstName}</b>\n`;
                report += `ID: <code>${user.telegramId}</code>\n\n`;
                report += `💸 **Request**: ${amount.toLocaleString()} MMK\n`;
                report += `Fee: ${fee.toLocaleString()}\n`;
                report += `Total Deducted: ${total.toLocaleString()}\n`;
                report += `Account: ${account.provider} - <code>${account.accountNumber}</code>\n\n`;
                report += `📊 **User History**\n`;
                report += `Income: ${income.toLocaleString()}\n`;
                report += `Topups: ${topup.toLocaleString()}\n`;
                report += `Spent: ${usage.toLocaleString()}\n`;
                report += `Current Balance: ${user.balance.toLocaleString()}`;

                const { InlineKeyboard } = await import('grammy');
                const adminKb = new InlineKeyboard()
                    .text("✅ Completed", `withdraw_complete_${tx._id}`).row()
                    .text("❌ Rejected", `withdraw_reject_${tx._id}`);

                await ctx.api.sendMessage(adminId, report, { parse_mode: 'HTML', reply_markup: adminKb });
            } catch (e) {
                console.error("Failed to notify admin:", e);
            }
        }
        return;
    }
    await next();
});

// Admin Withdrawal Actions
bot.callbackQuery(/^withdraw_complete_(.+)$/, async (ctx) => {
    const txId = ctx.match[1];
    const { default: Transaction } = await import('@/models/Transaction');
    const { default: User } = await import('@/models/User');

    console.log(`[DEBUG] processing withdraw_complete for: ${txId}`);
    const tx = await Transaction.findById(txId);

    // Check if already processed
    if (tx && tx.status === 'completed') {
        const currentText = ctx.callbackQuery?.message?.text || "Withdrawal Request";
        // If buttons still exist, remove them
        try {
            await ctx.editMessageText(currentText + "\n\n✅ ALREADY COMPLETED", { reply_markup: undefined });
        } catch (e) { /* ignore not modified */ }
        return ctx.answerCallbackQuery({ text: "Already Completed." });
    }

    if (!tx || tx.status !== 'pending') {
        return ctx.answerCallbackQuery({ text: "Tx not pending or found." });
    }

    tx.status = 'completed';
    tx.adminProcessedBy = ctx.user._id;
    await tx.save();

    await ctx.answerCallbackQuery({ text: "Marked Completed" });

    const originalText = ctx.callbackQuery?.message?.text || "Withdrawal Request";
    await ctx.editMessageText(originalText + "\n\n✅ COMPLETED", { reply_markup: undefined });

    // Notify User
    const targetUser = await User.findById(tx.fromUser);
    console.log(`[DEBUG] Found Target User for Notify: ${targetUser?._id} (TG: ${targetUser?.telegramId})`);

    if (targetUser) {
        try {
            await ctx.api.sendMessage(targetUser.telegramId, `✅ <b>Withdrawal Processed</b>\n\nYour withdrawal of ${tx.amount.toLocaleString()} MMK has been completed and sent to your account.`, { parse_mode: 'HTML' });
            console.log(`[DEBUG] Notification Sent to ${targetUser.telegramId}`);
        } catch (e) {
            console.error(`[DEBUG] Failed to send notification:`, e);
        }
    } else {
        console.warn(`[DEBUG] Target User Not Found for Tx: ${tx._id}`);
    }
});

bot.callbackQuery(/^withdraw_reject_(.+)$/, async (ctx) => {
    const txId = ctx.match[1];
    // Ask for Reason
    ctx.user.interactionState = 'awaiting_withdraw_reject_reason';
    ctx.user.tempData = { rejectTxId: txId };
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply("Please enter a reason for rejecting this withdrawal:", { reply_markup: { force_reply: true } });
});

bot.callbackQuery(/^buy_plan_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    const { handleBuyPlan } = await import('./subscription');
    await ctx.answerCallbackQuery();
    await handleBuyPlan(ctx, planId);
});
bot.callbackQuery(/^confirm_sub_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    const { handleConfirmSub } = await import('./subscription');
    // Don't answer CB yet? Or Answer with "Processing..."
    await ctx.answerCallbackQuery({ text: "Processing..." });
    await handleConfirmSub(ctx, planId);
});

bot.callbackQuery('cancel_plan_add', async (ctx) => {
    ctx.user.interactionState = 'idle';
    ctx.user.tempData = undefined;
    await ctx.user.save();

    const { getMerchantMenu } = await import('./menus');
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Cancelled.", { reply_markup: getMerchantMenu(ctx.user.language) });
});

bot.callbackQuery('cancel_sub', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();
});

bot.callbackQuery('add_payment_account', async (ctx) => {
    const { getProviderKeyboard } = await import('./menus');
    const { t } = await import('@/lib/i18n');

    ctx.user.interactionState = 'awaiting_payment_provider';
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx.user.language as any, 'select_provider'), { reply_markup: getProviderKeyboard(ctx.user.language) });
});

// Callback: Withdraw Start
bot.callbackQuery('withdraw_start', async (ctx) => {
    const user = ctx.user;
    if (user.balance < 10000) {
        return ctx.answerCallbackQuery({ text: "Min Withdraw: 10,000", show_alert: true });
    }

    // Check payment method
    if (!user.paymentMethods || user.paymentMethods.length === 0) {
        await ctx.answerCallbackQuery();
        await ctx.reply("You have no payment accounts set.\nDo you want to add one?", {
            reply_markup: new InlineKeyboard().text("➕ Add Account", "add_payment_account")
        });
        return;
    }

    user.interactionState = 'awaiting_withdraw_amount';
    await user.save();
    await ctx.reply("Enter amount to withdraw (Min 10,000):");
    await ctx.answerCallbackQuery();
});

// Admin Callbacks
bot.callbackQuery(/^topup_approve_(.+)$/, async (ctx) => {
    const txId = ctx.match[1];
    const user = ctx.user; // Admin

    const tx = await Transaction.findById(txId);
    if (!tx || tx.status !== 'pending') return ctx.answerCallbackQuery({ text: "Tx not pending." });

    const targetUser = await User.findById(tx.toUser);
    if (!targetUser) return ctx.answerCallbackQuery({ text: "User not found." });

    // Atomic Approve
    const mongoose = await import('mongoose');
    const session = await mongoose.default.startSession();
    session.startTransaction();
    try {
        tx.status = 'approved';
        tx.adminProcessedBy = user._id;
        await tx.save({ session });

        targetUser.balance += tx.amount;
        await targetUser.save({ session });

        await session.commitTransaction();
    } catch (e) {
        await session.abortTransaction();
        return ctx.reply("Error approving: " + e);
    } finally {
        session.endSession();
    }

    await ctx.editMessageCaption({ caption: ctx.msg?.caption + "\n\n✅ APPROVED" });
    await ctx.api.sendMessage(targetUser.telegramId, `✅ Topup of ${tx.amount} approved! Balance updated.`);
});

bot.callbackQuery(/^topup_reject_(.+)$/, async (ctx) => {
    const txId = ctx.match[1];

    // Set State for Reason
    ctx.user.interactionState = 'awaiting_reject_reason';
    ctx.user.tempData = { rejectTxId: txId };
    await ctx.user.save();

    const { t } = await import('@/lib/i18n');
    await ctx.reply(t(ctx.user.language as any, 'admin_reject_reason_prompt'));
    await ctx.answerCallbackQuery();

    // Update the message caption to indicate "Processing Rejection..."? 
    // Or leave it until reasoned?
    // Let's leave it.
});

// Invoice Management Callbacks
bot.callbackQuery(/^view_invoice_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const { default: Invoice } = await import('@/models/Invoice');
    const invoice = await Invoice.findById(id);

    if (!invoice) return ctx.answerCallbackQuery({ text: "Invoice not found." });

    // Check ownership
    // Convert to string to compare ObjectId
    if (String(invoice.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your invoice." });

    const amount = invoice.amount.toLocaleString();
    const date = new Date(invoice.createdAt).toLocaleString();
    const statusIcon = invoice.status === 'active' ? '✅' : '❌';

    let msg = `<b>Invoice Detail</b>\n\n` +
        `ID: <code>${invoice.uniqueId}</code>\n` +
        `Type: ${invoice.type.toUpperCase()}\n` +
        `Amount: ${amount} MMK\n` +
        `Status: ${statusIcon} ${invoice.status.toUpperCase()}\n` +
        `Payments Received: ${invoice.usageCount}\n` +
        `Created: ${date}`;

    // Fetch Payers
    // Limit to 5 most recent
    const { default: Transaction } = await import('@/models/Transaction');
    const { default: User } = await import('@/models/User'); // Ensure User model is loaded

    const payments = await Transaction.find({
        invoiceId: invoice._id,
        status: 'completed'
    }).sort({ createdAt: -1 }).limit(5).populate('fromUser'); // Populate full user details

    if (payments.length > 0) {
        msg += `\n\n<b>Recent Payers:</b>`;
        payments.forEach(tx => {
            const u = tx.fromUser as any;
            if (u) {
                const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown';
                const username = u.username ? `@${u.username}` : 'No Username';
                const idLink = `<a href="tg://user?id=${u.telegramId}">${u.telegramId}</a>`;
                const nameLink = `<a href="tg://user?id=${u.telegramId}">${name}</a>`;
                msg += `\n• ${nameLink} (${username}) [ID: ${idLink}]`;
            } else {
                msg += `\n• Unknown User`;
            }
        });
    } else {
        msg += `\n\nNo payments yet.`;
    }

    const { InlineKeyboard } = await import('grammy');
    const kb = new InlineKeyboard();

    if (invoice.status === 'active') {
        const botUsername = ctx.me.username;
        const query = `invoice_${invoice.uniqueId}`;

        kb.switchInline("📤 Send", query).row();
        kb.text("❌ Revoke", `revoke_invoice_${id}`).row();
    }

    kb.text("🔙 Back", `view_invoices_list_${invoice.type}`); // Back to List (Pass type)

    // Edit or Reply? Edit is better for navigation.
    // If checking list, we want to edit the list message.
    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
});

bot.callbackQuery(/^revoke_invoice_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const { default: Invoice } = await import('@/models/Invoice');
    const invoice = await Invoice.findById(id);

    if (!invoice) return ctx.answerCallbackQuery({ text: "Invoice not found." });
    if (String(invoice.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your invoice." });

    invoice.status = 'revoked';
    await invoice.save();

    await ctx.answerCallbackQuery({ text: "Invoice Revoked!" });

    // Refresh View
    // Trigger view handler logic again or manually update
    // easiest is manually update text
    const amount = invoice.amount.toLocaleString();
    const date = new Date(invoice.createdAt).toLocaleString();
    const statusIcon = '❌';

    const msg = `<b>Invoice Detail</b>\n\n` +
        `ID: <code>${invoice.uniqueId}</code>\n` +
        `Type: ${invoice.type.toUpperCase()}\n` +
        `Amount: $${amount}\n` +
        `Status: ${statusIcon} REVOKED\n` +
        `Usage: ${invoice.usageCount}\n` +
        `Created: ${date}`;

    const { InlineKeyboard } = await import('grammy');
    const kb = new InlineKeyboard()
        .text("🔙 Back", "merchant_menu_invoice");

    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
});

bot.callbackQuery(/^view_invoices_list_(.+)$/, async (ctx) => {
    const type = ctx.match[1]; // 'one-time' or 'reusable'
    const { showInvoices } = await import('./invoiceHandlers');
    await showInvoices(ctx, 1, type);
    // Was inline message, showInvoices will handle editing or new message logic.
    // If ctx.match (callback), showInvoices edit.
});

// Paginated Invoices
bot.callbackQuery(/^invoices_page_(\d+)_(.+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    const type = ctx.match[2]; // 'one-time' or 'reusable'
    const { showInvoices } = await import('./invoiceHandlers'); // New file? Or put in adminHandlers?
    // Let's keep it in handlers.ts or move to invoiceHandlers.ts?
    // Move to invoiceHandlers.ts is cleaner.
    await showInvoices(ctx, page, type);
});

bot.callbackQuery('merchant_menu_invoice', async (ctx) => {
    const { getInvoiceMenu } = await import('./menus');
    // If coming from Back button, we might want to show Invoice Menu (Create/View)
    // Or restart the whole flow?
    // "Back" button -> "merchant_menu_invoice" -> Shows "Invoices:" with Reply Keyboard?
    // Callback cannot trigger Reply Keyboard easily (requires sending new message).
    // If we want to return to list, we should probably just send the reply keyboard again.

    await ctx.answerCallbackQuery();
    await ctx.reply("Invoices:", { reply_markup: getInvoiceMenu(ctx.user.language) });
});

bot.callbackQuery('start_topup_flow', async (ctx) => {
    const { startTopupflow } = await import('./menuHandlers');
    await ctx.answerCallbackQuery();
    await startTopupflow(ctx);
});

// Admin Handlers
bot.command('admin', async (ctx) => {
    const { handleAdminCommand } = await import('./adminHandlers');
    await handleAdminCommand(ctx);
});

bot.callbackQuery('admin_stats', async (ctx) => {
    const { handleAdminStats } = await import('./adminHandlers');
    await handleAdminStats(ctx);
});

bot.callbackQuery('admin_broadcast', async (ctx) => {
    const { handleAdminBroadcast } = await import('./adminHandlers');
    await handleAdminBroadcast(ctx);
});

bot.callbackQuery('admin_home', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleAdminCommand } = await import('./adminHandlers');
    await handleAdminCommand(ctx);
    // Wait, handleAdminCommand uses reply (new message). 
    // We might want to edit. But reuse is fine for MVP.
});

// History
const historyKeys = [t('en', 'history_btn'), t('my', 'history_btn')];
bot.hears(historyKeys, async (ctx) => {
    const { showHistory } = await import('./menuHandlers');
    await showHistory(ctx, 1);
});

bot.callbackQuery(/^history_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    const { showHistory } = await import('./menuHandlers');
    await showHistory(ctx, page);
});

// My Subscriptions
const mySubsKeys = [t('en', 'my_subs_btn'), t('my', 'my_subs_btn')];
bot.hears(mySubsKeys, async (ctx) => {
    const { showUserSubscriptions } = await import('./subscriptionHandlers');
    await showUserSubscriptions(ctx, 1);
});

bot.callbackQuery(/^mysubs_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    const { showUserSubscriptions } = await import('./subscriptionHandlers');
    await showUserSubscriptions(ctx, page);
});

bot.callbackQuery('admin_users', async (ctx) => {
    const { handleAdminUsers } = await import('./adminHandlers');
    await handleAdminUsers(ctx);
});

bot.callbackQuery('remove_payment_account_menu', async (ctx) => {
    const user = ctx.user;
    if (!user.paymentMethods || user.paymentMethods.length === 0) {
        return ctx.answerCallbackQuery("No accounts to remove.");
    }

    // Show buttons to remove
    const { InlineKeyboard } = await import('grammy');
    const kb = new InlineKeyboard();
    user.paymentMethods.forEach((pm: any, i: number) => {
        kb.text(`🗑 ${pm.provider} - ${pm.accountNumber}`, `remove_acc_${i}`).row();
    });
    kb.text("🔙 Back", "settings_back"); // Or just close?

    await ctx.editMessageText("Select an account to remove:", { reply_markup: kb });
});

bot.callbackQuery(/^remove_acc_(\d+)$/, async (ctx) => {
    const index = parseInt(ctx.match[1]);
    const user = ctx.user;

    if (!user.paymentMethods || !user.paymentMethods[index]) {
        return ctx.answerCallbackQuery("Account not found.");
    }

    // Remove
    const removed = user.paymentMethods.splice(index, 1);
    await user.save();

    await ctx.answerCallbackQuery(`Removed ${removed[0].provider}`);

    // Refresh Settings
    // Trigger settings view again?
    // We can't trigger 'menuHandlers' easily from here without import.
    // Just edit message to show updated list logic?
    // Simpler to just re-call the Remove Menu logic or Main Settings logic.
    // Let's go back to Settings View options.

    // Manually construct Updated Settings text
    // Duplicate logic from menuHandlers... suboptimal but quick.
    // Or just say "Removed" and show "Back" button.

    const { InlineKeyboard } = await import('grammy');
    const kb = new InlineKeyboard().text("🔙 Back to Settings", "back_to_settings_refresh");
    await ctx.editMessageText("✅ Account Removed.", { reply_markup: kb });
});

bot.callbackQuery('back_to_settings_refresh', async (ctx) => {
    const { showSettings } = await import('./menuHandlers');
    await showSettings(ctx);
});

bot.callbackQuery(/^admin_unfreeze_(.+)$/, async (ctx) => {
    const { handleUnfreezeUser } = await import('./adminHandlers');
    await handleUnfreezeUser(ctx, ctx.match[1]);
});

bot.callbackQuery(/^admin_freeze_(.+)$/, async (ctx) => {
    const { handleFreezeUser } = await import('./adminHandlers');
    await handleFreezeUser(ctx, ctx.match[1]);
});

bot.callbackQuery('admin_find_user', async (ctx) => {
    const { handleFindUserPrompt } = await import('./adminHandlers');
    await handleFindUserPrompt(ctx);
});

// Inline Query
bot.on('inline_query', async (ctx) => {
    const { handleInlineQuery } = await import('./inline');
    handleInlineQuery(ctx);
});

// All other messages (Menu clicks, text)
bot.on('message', async (ctx) => {
    const { handleMenuClick } = await import('./menuHandlers');
    handleMenuClick(ctx);
});
