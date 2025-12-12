import { bot } from './bot';
import { t } from '@/lib/i18n';
import User from '@/models/User';
import MerchantProfile from '@/models/MerchantProfile';
import Transaction from '@/models/Transaction';
import { InlineKeyboard } from 'grammy';
import { handlePaymentStart, initPaymentHandlers } from './payment';

// Initialize payment listeners
initPaymentHandlers();

// Onboarding / Start
bot.command('start', async (ctx) => {
    const payload = ctx.match; // Deep link payload
    const user = ctx.user;
    console.log('/start called by:', user.telegramId);

    if (payload && payload.startsWith('pay_')) {
        if (!user.termsAccepted) {
            // Defer
            user.tempData = { deferredPayload: payload };
            await user.save();
            // Fall through to ToS check
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

        const { handlePaymentStart } = await import('./payment');
        return handlePaymentStart(ctx, payload);
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

bot.callbackQuery('add_payment_account', async (ctx) => {
    // In a real app, we'd ask for provider, then number. 
    // Simplified: Just ask for "Provider AccountNumber" in one go or use state.
    // Let's set state.
    ctx.user.interactionState = 'awaiting_account_details';
    await ctx.user.save();
    await ctx.answerCallbackQuery();
    await ctx.reply("Please enter account details in format:\n<code>Provider Name Number</code>\nExample: <code>KPay John 09123456789</code>", { parse_mode: 'HTML' });
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
    const user = ctx.user;

    const { default: Invoice } = await import('@/models/Invoice');
    const invoices = await Invoice.find({
        merchantId: user._id,
        type: type,
        status: { $ne: 'revoked' }
    }).sort({ createdAt: -1 }).limit(10);

    if (invoices.length === 0) {
        // Should not happen if we came from list, unless revoked?
        // If empty, show "No active". But we need a Back button to Merchant or Type select?
        const { getInvoiceMenu } = await import('./menus');
        await ctx.deleteMessage(); // Delete the inline status message? 
        // Or edit text.
        await ctx.reply(`No active ${type} invoices found.`, { reply_markup: getInvoiceMenu(user.language) });
    } else {
        const { InlineKeyboard } = await import('grammy');
        const kb = new InlineKeyboard();

        invoices.forEach((inv) => {
            const amount = inv.amount.toLocaleString();
            kb.text(`${amount} MMK (${inv.usageCount} Paid)`, `view_invoice_${inv._id}`).row();
        });

        // This is editing the message, so we keep "HTML" mode.
        // Title?
        await ctx.editMessageText(`🧾 <b>Select ${type} Invoice</b>`, {
            reply_markup: kb,
            parse_mode: 'HTML'
        });
        // Also update the keyboard? We can't update Reply Keyboard via Callback.
        // We can only send a new message.
        // But 'ctx.editMessageText' edits the INLINE message.
        // The Reply Keyboard persists from before.
        // If we want to enforce "Only Back Button", we must send it when showing list.
        // But this is a callback. sending new message might be spammy if user clicks Back<->List often.
        // User's request "Invoices > View Invoices > One Time > show list" refers to the INITIAL flow via stateHandler.
        // If navigating Back from Detail, the Reply Keyboard should ideally already BE the correct one.
        // So we might not need to send it again here, assuming stateHandler set it.
    }
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

// Inline Query
import { handleInlineQuery } from './inline';
bot.on('inline_query', handleInlineQuery);

import { handleMenuClick } from './menuHandlers';
bot.on('message:text', handleMenuClick);
