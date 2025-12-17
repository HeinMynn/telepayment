import { bot } from './bot';

// Import Handlers
import './chatMemberHandler';
import { t } from '@/lib/i18n';
import User from '@/models/User';
import MerchantProfile from '@/models/MerchantProfile';
import Transaction from '@/models/Transaction';
import { InlineKeyboard } from 'grammy';
import { handlePaymentStart, initPaymentHandlers } from './payment';

// Static imports for performance (previously dynamic)
import MerchantChannel from '@/models/MerchantChannel';
import SubscriptionPlan from '@/models/SubscriptionPlan';
import Subscription from '@/models/Subscription';
import Invoice from '@/models/Invoice';
import { logAudit, AUDIT_ACTIONS } from '@/lib/auditLog';
import { getMainMenu, getMerchantMenu, getInvoiceMenu, getCancelKeyboard, getProviderKeyboard, getPaginationKeyboard } from './menus';
import { handleMenuClick, showHistory, showSettings, startTopupflow, sendVisualOnboarding, handleOnboardingCallback } from './menuHandlers';
import { showUserSubscriptions, handleManageChannels, handleChannelDetails, handleChannelStart, handleSubscriptionStart, handleBuySubscription } from './subscriptionHandlers';
import { showInvoices } from './invoiceHandlers';
import { handleAdminCommand, handleAdminStats, handleAdminBroadcast, handleAdminUsers, handleUnfreezeUser, handleFreezeUser, handleFindUserPrompt } from './adminHandlers';
import { handleBuyPlan, handleConfirmSub } from './subscription';
import { handleInlineQuery } from './inline';
import mongoose from 'mongoose';

// Initialize payment listeners
initPaymentHandlers();

// Register Subscription Buying Callback
bot.callbackQuery(/^buy_sub_(.+)$/, async (ctx) => {
    await handleBuySubscription(ctx, ctx.match[1]);
});

// Global Debug Loggernt listeners

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

    if (payload && (payload.startsWith('pay_') || payload.startsWith('sub_') || payload.startsWith('ch_'))) {
        if (!user.termsAccepted) {
            // Defer
            user.tempData = { deferredPayload: payload };
            await user.save();
            // Fall through to ToS check
        } else if (payload.startsWith('ch_')) {
            return handleChannelStart(ctx, payload);
        } else if (payload.startsWith('sub_')) {
            return handleSubscriptionStart(ctx, payload);
        } else {
            return handlePaymentStart(ctx, payload);
        }
    }

    // Referral Attribution
    if (payload && payload.startsWith('ref_')) {
        console.log(`[Referral Debug] Payload: ${payload}`);
        const refId = parseInt(payload.replace('ref_', ''));
        console.log(`[Referral Debug] Parsed refId: ${refId}, user.telegramId: ${user.telegramId}, user.referrer: ${user.referrer}`);

        if (!isNaN(refId) && refId !== user.telegramId && !user.referrer) {
            // Find Referrer
            const referrerUser = await User.findOne({ telegramId: refId });
            console.log(`[Referral Debug] Found referrer: ${referrerUser ? referrerUser.telegramId : 'NOT FOUND'}`);

            if (referrerUser) {
                user.referrer = referrerUser._id;
                await user.save();
                console.log(`[Referral] User ${user.telegramId} referred by ${refId} - SAVED`);
            }
        } else {
            console.log(`[Referral Debug] Skipped - isNaN:${isNaN(refId)}, self:${refId === user.telegramId}, hasReferrer:${!!user.referrer}`);
        }
    }
    if (!user.termsAccepted) {
        const keyboard = new InlineKeyboard().text(t(user.language as any, 'tos_agree'), 'accept_tos');
        await ctx.reply(t(user.language as any, 'welcome') + "\n\n" + t(user.language as any, 'tos_text'), { reply_markup: keyboard });
    } else {
        // Send Welcome + Main Menu first
        await ctx.reply(t(user.language as any, 'welcome'), { reply_markup: getMainMenu(user.role, user.language) });

        // Then Visual Onboarding
        try {
            await sendVisualOnboarding(ctx);
        } catch (e) { console.error("Onboarding Error", e); }
    }
});


bot.callbackQuery('cancel_topup_upload', async (ctx) => {
    const user = ctx.user;
    user.interactionState = 'idle';
    user.tempData = undefined;
    await user.save();

    await ctx.answerCallbackQuery("Cancelled.");
    try {
        await ctx.editMessageText("Upload cancelled.");
    } catch (e) { /* ignore */ }

    await ctx.reply("Cancelled.", { reply_markup: getMainMenu(user.role, user.language) });
});

bot.callbackQuery(/^mysubs_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await showUserSubscriptions(ctx, page);
});

// Onboarding Carousel
bot.callbackQuery(/^onboard_(.+)$/, async (ctx) => {
    const step = ctx.match[1];
    await handleOnboardingCallback(ctx, step);
});

bot.callbackQuery('explore_channels', async (ctx) => {
    const l = ctx.user.language as any;

    const kb = new InlineKeyboard()
        .text(t(l, 'cat_entertainment'), 'explore_cat_entertainment').text(t(l, 'cat_education'), 'explore_cat_education').row()
        .text(t(l, 'cat_business'), 'explore_cat_business').text(t(l, 'cat_gaming'), 'explore_cat_gaming').row()
        .text(t(l, 'cat_lifestyle'), 'explore_cat_lifestyle').text(t(l, 'cat_other'), 'explore_cat_other').row()
        .text(t(l, 'cat_all'), 'explore_cat_all');

    await ctx.reply(t(l, 'explore_title'), { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
});

// Explore by Category (with pagination)
bot.callbackQuery(/^explore_cat_(.+?)(?:_page_(\d+))?$/, async (ctx) => {
    const category = ctx.match[1];
    const page = parseInt(ctx.match[2] || '1');
    const pageSize = 5;

    const l = ctx.user.language as any;

    // Build query
    const query: any = { isActive: true };
    if (category !== 'all') {
        query.category = category;
    }

    const channels = await MerchantChannel.find(query).skip((page - 1) * pageSize).limit(pageSize + 1); // +1 to check if more
    const hasMore = channels.length > pageSize;
    if (hasMore) channels.pop();

    // Filter by having plans
    const validChannels: any[] = [];
    for (const ch of channels) {
        const count = await SubscriptionPlan.countDocuments({ channelId: ch._id, isActive: true });
        if (count > 0) validChannels.push(ch);
    }

    if (validChannels.length === 0 && page === 1) {
        await ctx.answerCallbackQuery({ text: t(l, 'explore_no_channels'), show_alert: true });
        return;
    }

    const kb = new InlineKeyboard();
    validChannels.forEach(ch => {
        kb.text(`📢 ${ch.title}`, `ch_${ch._id}`).row();
    });

    // Pagination
    if (page > 1) kb.text('◀️ Prev', `explore_cat_${category}_page_${page - 1}`);
    if (hasMore) kb.text('Next ▶️', `explore_cat_${category}_page_${page + 1}`);
    if (page > 1 || hasMore) kb.row();

    kb.row().text('🔙 Categories', 'explore_channels');

    const catLabel = category === 'all' ? t(l, 'cat_all') : t(l, `cat_${category}` as any);
    const msg = `🔍 <b>${catLabel}</b>\n\nPage ${page}`;

    if (ctx.callbackQuery?.message) {
        try {
            await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
        } catch (e) { }
    } else {
        await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
    }
    await ctx.answerCallbackQuery();
});

// User selects channel from explore list
bot.callbackQuery(/^ch_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await handleChannelStart(ctx, `ch_${channelId}`);
});

// Invite / Referral
bot.command('invite', async (ctx) => {
    const user = ctx.user;
    if (!ctx.me?.username) return;

    const link = `https://t.me/${ctx.me.username}?start=ref_${user.telegramId}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me on this awesome payment bot!')}`;

    const kb = new InlineKeyboard().url('📤 Share with Friends', shareUrl);

    await ctx.reply(`🎁 <b>Invite Friends & Earn!</b>\n\nShare this link. When a friend joins and makes their FIRST top-up, you earn <b>1%</b> of the amount!\n\n🔗 Your Link:\n<blockquote><code>${link}</code></blockquote>`, {
        parse_mode: 'HTML',
        reply_markup: kb
    });
});

// Handle Renew (Callback)
bot.on('callback_query:data', async (ctx, next) => {
    if (ctx.callbackQuery.data.startsWith('renew_sub_')) {
        // adapt renew_sub_CHANNELID -> ch_CHANNELID
        const payload = ctx.callbackQuery.data.replace('renew_sub_', 'ch_');
        return handleChannelStart(ctx, payload);
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

        if (payload.startsWith('ch_')) {
            return handleChannelStart(ctx, payload);
        } else if (payload.startsWith('sub_')) {
            return handleSubscriptionStart(ctx, payload);
        } else {
            return handlePaymentStart(ctx, payload);
        }
    }

    // Visual Onboarding for new users
    try {
        await sendVisualOnboarding(ctx);
    } catch (e) { console.error("Onboarding Error", e); }

    // Send Main Menu
    await ctx.editMessageText(t(user.language as any, 'welcome') + "\n\n✅ Terms Accepted.");
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



// Pagination for Manage Channels
bot.callbackQuery(/^channels_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await handleManageChannels(ctx, page);
});

// Channel Management Callbacks
bot.callbackQuery('add_channel_start', async (ctx) => {
    const user = ctx.user;

    user.interactionState = 'awaiting_channel_username';
    await user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply(t(user.language as any, 'channel_add_prompt'), { reply_markup: getCancelKeyboard(user.language) });
});

bot.callbackQuery(/^manage_ch_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await handleChannelDetails(ctx, channelId);
});

bot.callbackQuery(/^add_plan_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];

    // Ask Duration first
    const kb = new InlineKeyboard()
        .text("1 Month", `plan_dur_1_${channelId}`).row()
        .text("3 Months", `plan_dur_3_${channelId}`).row()
        .text("6 Months", `plan_dur_6_${channelId}`).row()
        .text("1 Year", `plan_dur_12_${channelId}`);

    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx.user.language as any, 'plan_duration_prompt'), { reply_markup: kb });
});

bot.callbackQuery(/^plan_dur_(\d+)_(.+)$/, async (ctx) => {
    // 1 = Duration, 2 = ChannelId
    const duration = parseInt(ctx.match[1]);
    const channelId = ctx.match[2];

    // Set State
    ctx.user.interactionState = 'awaiting_plan_price';
    ctx.user.tempData = { planDuration: duration, planChannelId: channelId };
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx.user.language as any, 'plan_price_prompt'), { reply_markup: getCancelKeyboard(ctx.user.language) });
});

bot.callbackQuery(/^buy_plan_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await handleBuySubscription(ctx, planId);
});

bot.callbackQuery('add_channel', async (ctx) => {
    ctx.user.interactionState = 'awaiting_channel_username';
    await ctx.user.save();
    await ctx.answerCallbackQuery();
    await ctx.reply(t(ctx.user.language as any, 'channel_add_prompt'), { reply_markup: getCancelKeyboard(ctx.user.language) });
});

// Channel Category Selection (after channel verification)
bot.callbackQuery(/^ch_cat_(.+)$/, async (ctx) => {
    const category = ctx.match[1] as any;
    const user = ctx.user;

    if (user.interactionState !== 'awaiting_channel_category' || !user.tempData) {
        return ctx.answerCallbackQuery({ text: "Session expired. Please try again." });
    }

    const { channelId, title, username } = user.tempData;
    const l = user.language as any;

    // Save to DB with category
    const savedChannel = await MerchantChannel.findOneAndUpdate(
        { merchantId: user._id, channelId: channelId },
        {
            merchantId: user._id,
            channelId: channelId,
            title: title,
            username: username,
            isActive: true,
            category: category
        },
        { upsert: true, new: true }
    );

    // Audit Log
    await logAudit(user._id, AUDIT_ACTIONS.CHANNEL_ADDED, 'channel', String(savedChannel._id), {
        channelTitle: title,
        category
    });

    user.interactionState = 'idle';
    user.tempData = undefined;
    await user.save();

    await ctx.answerCallbackQuery({ text: "Channel added!" });
    await ctx.editMessageText(`✅ Channel "<b>${title}</b>" added to <b>${t(l, `cat_${category}` as any)}</b>!`, { parse_mode: 'HTML' });
    await ctx.reply("Merchant Menu:", { reply_markup: getMerchantMenu(user.language) });
});

// Edit Channel Category - Show category selection
bot.callbackQuery(/^edit_ch_cat_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const l = ctx.user.language as any;

    const kb = new InlineKeyboard()
        .text(t(l, 'cat_entertainment'), `update_ch_cat_${channelId}_entertainment`)
        .text(t(l, 'cat_education'), `update_ch_cat_${channelId}_education`).row()
        .text(t(l, 'cat_business'), `update_ch_cat_${channelId}_business`)
        .text(t(l, 'cat_gaming'), `update_ch_cat_${channelId}_gaming`).row()
        .text(t(l, 'cat_lifestyle'), `update_ch_cat_${channelId}_lifestyle`)
        .text(t(l, 'cat_other'), `update_ch_cat_${channelId}_other`).row()
        .text("🔙 Cancel", `manage_ch_${channelId}`);

    await ctx.editMessageText("Select a new category:", { reply_markup: kb });
    await ctx.answerCallbackQuery();
});

// Update Channel Category - Save new category
bot.callbackQuery(/^update_ch_cat_(.+)_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const category = ctx.match[2];

    const l = ctx.user.language as any;

    const ch = await MerchantChannel.findById(channelId);
    if (!ch) return ctx.answerCallbackQuery({ text: "Channel not found." });
    if (String(ch.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your channel." });

    const oldCategory = ch.category || 'other';
    ch.category = category as any;
    await ch.save();

    // Audit Log
    // Audit Log
    await logAudit(ctx.user._id, AUDIT_ACTIONS.CHANNEL_CATEGORY_CHANGED, 'channel', channelId, {
        channelTitle: ch.title,
        oldCategory,
        newCategory: category
    });

    await ctx.answerCallbackQuery({ text: "Category updated!" });

    // Redirect back to channel details
    try { await ctx.deleteMessage(); } catch (e) { }
    await handleChannelDetails(ctx, channelId);
});

// Manage Plans - Show list of all plans
bot.callbackQuery(/^manage_plans_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];

    const ch = await MerchantChannel.findById(channelId);
    if (!ch) return ctx.answerCallbackQuery({ text: "Channel not found." });
    if (String(ch.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your channel." });

    const plans = await SubscriptionPlan.find({ channelId: ch._id });

    if (plans.length === 0) {
        return ctx.answerCallbackQuery({ text: "No plans to manage. Add a plan first.", show_alert: true });
    }

    let msg = `📋 <b>Manage Plans - ${ch.title}</b>\n\nSelect a plan to edit:\n`;
    const kb = new InlineKeyboard();

    plans.forEach((p: any) => {
        const status = p.isActive ? '✅' : '❌';
        const name = p.name || `${p.durationMonths} Month(s)`;
        msg += `\n${status} ${name} - ${p.price.toLocaleString()} MMK`;
        kb.text(`${status} ${name}`, `edit_plan_${p._id}`).row();
    });

    kb.text("🔙 Back", `manage_ch_${channelId}`);

    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
});

// Edit Plan - Show options
bot.callbackQuery(/^edit_plan_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];

    const plan = await SubscriptionPlan.findById(planId).populate('channelId');
    if (!plan) return ctx.answerCallbackQuery({ text: "Plan not found." });

    const ch = plan.channelId as any;
    if (String(ch.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your plan." });

    const name = (plan as any).name || `${plan.durationMonths} Month(s)`;
    const status = plan.isActive ? '✅ Active' : '❌ Inactive';

    const msg = `✏️ <b>Edit Plan</b>\n\n` +
        `<b>Plan:</b> ${name}\n` +
        `<b>Duration:</b> ${plan.durationMonths} month(s)\n` +
        `<b>Price:</b> ${plan.price.toLocaleString()} MMK\n` +
        `<b>Status:</b> ${status}`;

    const kb = new InlineKeyboard()
        .text("💰 Edit Price", `edit_plan_price_${planId}`).row()
        .text(plan.isActive ? "❌ Disable Plan" : "✅ Enable Plan", `toggle_plan_${planId}`).row()
        .text("🔙 Back", `manage_plans_${ch._id}`);

    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
});

// Toggle Plan Active/Inactive
bot.callbackQuery(/^toggle_plan_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];

    const plan = await SubscriptionPlan.findById(planId).populate('channelId');
    if (!plan) return ctx.answerCallbackQuery({ text: "Plan not found." });

    const ch = plan.channelId as any;
    if (String(ch.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your plan." });

    const wasActive = plan.isActive;
    plan.isActive = !plan.isActive;
    await plan.save();

    // Audit Log
    await logAudit(ctx.user._id, AUDIT_ACTIONS.PLAN_TOGGLED, 'plan', planId, {
        planName: (plan as any).name || `${plan.durationMonths} Month(s)`,
        channelTitle: ch.title,
        wasActive,
        isActive: plan.isActive
    });

    await ctx.answerCallbackQuery({ text: plan.isActive ? "Plan enabled!" : "Plan disabled!" });

    // Refresh edit view
    const name = (plan as any).name || `${plan.durationMonths} Month(s)`;
    const status = plan.isActive ? '✅ Active' : '❌ Inactive';

    const msg = `✏️ <b>Edit Plan</b>\n\n` +
        `<b>Plan:</b> ${name}\n` +
        `<b>Duration:</b> ${plan.durationMonths} month(s)\n` +
        `<b>Price:</b> ${plan.price.toLocaleString()} MMK\n` +
        `<b>Status:</b> ${status}`;

    const kb = new InlineKeyboard()
        .text("💰 Edit Price", `edit_plan_price_${planId}`).row()
        .text(plan.isActive ? "❌ Disable Plan" : "✅ Enable Plan", `toggle_plan_${planId}`).row()
        .text("🔙 Back", `manage_plans_${ch._id}`);

    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
});

// Edit Plan Price - Prompt
bot.callbackQuery(/^edit_plan_price_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];

    const plan = await SubscriptionPlan.findById(planId).populate('channelId');
    if (!plan) return ctx.answerCallbackQuery({ text: "Plan not found." });

    const ch = plan.channelId as any;
    if (String(ch.merchantId) !== String(ctx.user._id)) return ctx.answerCallbackQuery({ text: "Not your plan." });

    ctx.user.interactionState = 'awaiting_plan_new_price';
    ctx.user.tempData = { editPlanId: planId, channelId: ch._id };
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply(`Current price: ${plan.price.toLocaleString()} MMK\n\nEnter new price (MMK):`, {
        reply_markup: { force_reply: true }
    });
});

bot.callbackQuery('admin_channels_back', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch (e) { }
    await handleManageChannels(ctx);
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
    // Admin check
    if (ctx.user.role !== 'admin') return ctx.answerCallbackQuery({ text: "Not authorized." });

    const txId = ctx.match[1];

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
    // Admin check
    if (ctx.user.role !== 'admin') return ctx.answerCallbackQuery({ text: "Not authorized." });

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
    await ctx.answerCallbackQuery();
    await handleBuyPlan(ctx, planId);
});
bot.callbackQuery(/^confirm_sub_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    // Don't answer CB yet? Or Answer with "Processing..."
    await ctx.answerCallbackQuery({ text: "Processing..." });
    await handleConfirmSub(ctx, planId);
});

bot.callbackQuery('cancel_plan_add', async (ctx) => {
    ctx.user.interactionState = 'idle';
    ctx.user.tempData = undefined;
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply("Cancelled.", { reply_markup: getMerchantMenu(ctx.user.language) });
    try {
        await ctx.deleteMessage(); // Remove the inline menu message
    } catch (e) { }
});

bot.callbackQuery('cancel_sub', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();
});

bot.callbackQuery('add_payment_account', async (ctx) => {
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
    // Admin check
    if (ctx.user.role !== 'admin') return ctx.answerCallbackQuery({ text: "Not authorized." });

    const txId = ctx.match[1];
    const user = ctx.user; // Admin

    const tx = await Transaction.findById(txId);
    if (!tx || tx.status !== 'pending') return ctx.answerCallbackQuery({ text: "Tx not pending." });

    const targetUser = await User.findById(tx.toUser);
    if (!targetUser) return ctx.answerCallbackQuery({ text: "User not found." });

    // Atomic Approve
    const session = await mongoose.startSession();
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

    // Referral Reward (1% on First Topup)
    console.log(`[Referral Reward Debug] targetUser.referrer: ${targetUser.referrer}, referralRewardClaimed: ${targetUser.referralRewardClaimed}`);

    if (targetUser.referrer && !targetUser.referralRewardClaimed) {
        try {
            const referrer = await User.findById(targetUser.referrer);
            console.log(`[Referral Reward Debug] Referrer found: ${referrer ? referrer.telegramId : 'NOT FOUND'}`);

            if (referrer) {
                const bonus = Math.floor(tx.amount * 0.01);
                console.log(`[Referral Reward Debug] Bonus calculated: ${bonus} (from ${tx.amount})`);

                if (bonus > 0) {
                    referrer.balance += bonus;
                    targetUser.referralRewardClaimed = true;

                    // Save Update
                    await referrer.save();
                    await targetUser.save();

                    // Create Bonus Transaction
                    await Transaction.create({
                        toUser: referrer._id,
                        amount: bonus,
                        type: 'referral',
                        status: 'completed'
                    });

                    // Notify
                    await ctx.api.sendMessage(referrer.telegramId, `🎉 <b>Referral Bonus!</b>\n\nA friend you invited just made their first top-up!\nYou earned 1% (${bonus} MMK).`, { parse_mode: 'HTML' });
                    console.log(`[Referral] Paid ${bonus} to ${referrer.telegramId} - SUCCESS`);
                }
            }
        } catch (e) {
            console.error("Referral Bonus Error:", e);
        }
    } else {
        console.log(`[Referral Reward Debug] Skipped - hasReferrer: ${!!targetUser.referrer}, claimed: ${targetUser.referralRewardClaimed}`);
    }
});

bot.callbackQuery(/^topup_reject_(.+)$/, async (ctx) => {
    // Admin check
    if (ctx.user.role !== 'admin') return ctx.answerCallbackQuery({ text: "Not authorized." });

    const txId = ctx.match[1];

    // Set State for Reason
    ctx.user.interactionState = 'awaiting_reject_reason';
    ctx.user.tempData = { rejectTxId: txId };
    await ctx.user.save();

    await ctx.reply(t(ctx.user.language as any, 'admin_reject_reason_prompt'));
    await ctx.answerCallbackQuery();

    // Update the message caption to indicate "Processing Rejection..."? 
    // Or leave it until reasoned?
    // Let's leave it.
});

// Invoice Management Callbacks
bot.callbackQuery(/^view_invoice_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
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

    const kb = new InlineKeyboard()
        .text("🔙 Back", "merchant_menu_invoice");

    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
});

bot.callbackQuery(/^view_invoices_list_(.+)$/, async (ctx) => {
    const type = ctx.match[1]; // 'one-time' or 'reusable'
    await showInvoices(ctx, 1, type);
    // Was inline message, showInvoices will handle editing or new message logic.
    // If ctx.match (callback), showInvoices edit.
});

// Paginated Invoices
bot.callbackQuery(/^invoices_page_(\d+)_(.+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    const type = ctx.match[2]; // 'one-time' or 'reusable'
    // Let's keep it in handlers.ts or move to invoiceHandlers.ts?
    // Move to invoiceHandlers.ts is cleaner.
    await showInvoices(ctx, page, type);
});

bot.callbackQuery('merchant_menu_invoice', async (ctx) => {
    // If coming from Back button, we might want to show Invoice Menu (Create/View)
    // Or restart the whole flow?
    // "Back" button -> "merchant_menu_invoice" -> Shows "Invoices:" with Reply Keyboard?
    // Callback cannot trigger Reply Keyboard easily (requires sending new message).
    // If we want to return to list, we should probably just send the reply keyboard again.

    await ctx.answerCallbackQuery();
    await ctx.reply("Invoices:", { reply_markup: getInvoiceMenu(ctx.user.language) });
});

bot.callbackQuery('start_topup_flow', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startTopupflow(ctx);
});

// Admin Handlers
bot.command('admin', async (ctx) => {
    await handleAdminCommand(ctx);
});

bot.callbackQuery('admin_stats', async (ctx) => {
    await handleAdminStats(ctx);
});

bot.callbackQuery('admin_broadcast', async (ctx) => {
    await handleAdminBroadcast(ctx);
});

bot.callbackQuery('admin_home', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleAdminCommand(ctx);
    // Wait, handleAdminCommand uses reply (new message). 
    // We might want to edit. But reuse is fine for MVP.
});

// History
const historyKeys = [t('en', 'history_btn'), t('my', 'history_btn')];
bot.hears(historyKeys, async (ctx) => {
    await showHistory(ctx, 1);
});

bot.callbackQuery(/^history_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await showHistory(ctx, page);
});

// My Subscriptions
const mySubsKeys = [t('en', 'my_subs_btn'), t('my', 'my_subs_btn')];
bot.hears(mySubsKeys, async (ctx) => {
    await showUserSubscriptions(ctx, 1);
});

bot.callbackQuery(/^mysubs_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await showUserSubscriptions(ctx, page);
});

bot.callbackQuery('admin_users', async (ctx) => {
    await handleAdminUsers(ctx);
});

bot.callbackQuery('remove_payment_account_menu', async (ctx) => {
    const user = ctx.user;
    if (!user.paymentMethods || user.paymentMethods.length === 0) {
        return ctx.answerCallbackQuery("No accounts to remove.");
    }

    // Show buttons to remove
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

    const kb = new InlineKeyboard().text("🔙 Back to Settings", "back_to_settings_refresh");
    await ctx.editMessageText("✅ Account Removed.", { reply_markup: kb });
});

bot.callbackQuery('back_to_settings_refresh', async (ctx) => {
    await showSettings(ctx);
});

bot.callbackQuery(/^admin_unfreeze_(.+)$/, async (ctx) => {
    // Admin check
    if (ctx.user.role !== 'admin') return ctx.answerCallbackQuery({ text: "Not authorized." });

    await handleUnfreezeUser(ctx, ctx.match[1]);
});

bot.callbackQuery(/^admin_freeze_(.+)$/, async (ctx) => {
    // Admin check
    if (ctx.user.role !== 'admin') return ctx.answerCallbackQuery({ text: "Not authorized." });

    await handleFreezeUser(ctx, ctx.match[1]);
});

bot.callbackQuery('admin_find_user', async (ctx) => {
    await handleFindUserPrompt(ctx);
});

// Inline Query
bot.on('inline_query', async (ctx) => {
    handleInlineQuery(ctx);
});

// All other messages (Menu clicks, text)
bot.on('message', async (ctx) => {
    handleMenuClick(ctx);
});
