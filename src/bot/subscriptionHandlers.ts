import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import { getPaginationKeyboard } from './menus';
import { t } from '@/lib/i18n';

export async function showUserSubscriptions(ctx: BotContext, page: number, editMessageId?: number) {
    const { default: Subscription } = await import('@/models/Subscription');
    const { default: MerchantChannel } = await import('@/models/MerchantChannel'); // Need to populate?

    // Mongoose populate is easier if Schema is set up. 
    // Assuming Subscription has ref to 'MerchantChannel'.

    const user = ctx.user;
    const l = user.language as any;
    const pageSize = 5;
    const skip = (page - 1) * pageSize;

    const filter = { userId: user._id };

    const totalCount = await Subscription.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalCount === 0) {
        const kb = new InlineKeyboard()
            .text("🔍 Explore Channels", "explore_channels"); // Needs handler
        if (page === 1) await ctx.reply(t(l, 'no_subs'), { reply_markup: kb });
        else await ctx.answerCallbackQuery(t(l, 'no_more_results'));
        return;
    }

    const subs = await Subscription.find(filter)
        .sort({ endDate: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('channelId'); // Populate channel details

    let report = `<b>${t(l, 'sub_history_title')} (Page ${page}/${totalPages})</b>\n`;

    subs.forEach((sub: any) => {
        const channelName = sub.channelId?.title || "Unknown Channel";
        const expiry = new Date(sub.endDate).toLocaleDateString();
        const status = sub.status === 'active' ? t(l, 'sub_active') : t(l, 'sub_expired');
        const icon = sub.status === 'active' ? '🟢' : '🔴';

        report += `\n${icon} <b>${channelName}</b>`;
        report += `\n📅 Exp: ${expiry} | ${status}\n`;
    });

    const kb = getPaginationKeyboard(page, totalPages, 'mysubs');

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(report, { parse_mode: 'HTML', reply_markup: kb });
        } catch (e: any) {
            if (e.description?.includes('message is not modified')) {
                await ctx.answerCallbackQuery("Updated.");
            }
        }
    } else if (editMessageId) {
        try {
            await ctx.api.editMessageText(ctx.chat?.id!, editMessageId, report, { parse_mode: 'HTML', reply_markup: kb });
        } catch (e) { /* ignore */ }
    } else {
        await ctx.reply(report, { parse_mode: 'HTML', reply_markup: kb });
    }
}

export async function handleSubscriptionStart(ctx: BotContext, payload: string) {
    // Payload: sub_PLANID
    const planId = payload.replace('sub_', '');

    // Import Models
    const { default: SubscriptionPlan } = await import('@/models/SubscriptionPlan');
    const { default: MerchantChannel } = await import('@/models/MerchantChannel');
    const { default: User } = await import('@/models/User');

    const plan = await SubscriptionPlan.findById(planId).populate('channelId');

    if (!plan) {
        return ctx.reply("❌ Limit Plan or Channel not found.");
    }

    const channel = plan.channelId as any;
    const user = ctx.user;

    const price = plan.price;
    const balance = user.balance;

    const msg = `🛒 <b>Purchase Subscription</b>\n\n` +
        `Channel: <b>${channel.title}</b>\n` +
        `Plan: ${plan.name || `${plan.durationMonths} Month(s)`} (${plan.durationMonths} month(s))\n` +
        `Price: <b>${price.toLocaleString()} MMK</b>\n\n` +
        `Your Balance: ${balance.toLocaleString()} MMK`;

    const kb = new InlineKeyboard();

    if (balance >= price) {
        kb.text(`✅ Pay with Balance`, `buy_sub_${plan._id}`); // Handler needed!
    } else {
        kb.text(`💰 Top Up Balance`, `topup_start`); // Generic topup
    }

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleBuySubscription(ctx: BotContext, planId: string) {
    const { default: SubscriptionPlan } = await import('@/models/SubscriptionPlan');
    const { default: Subscription } = await import('@/models/Subscription');
    const { default: Transaction } = await import('@/models/Transaction');
    const { default: User } = await import('@/models/User');

    const plan = await SubscriptionPlan.findById(planId).populate('channelId');
    if (!plan) return ctx.answerCallbackQuery("Plan not found.");


    const channelTitle = (plan.channelId as any).title;
    const planName = plan.name || `${plan.durationMonths} Month(s)`;

    const user = await User.findById(ctx.user._id); // Refresh user
    if (!user) return;

    if (user.balance < plan.price) {
        return ctx.answerCallbackQuery("Insufficient Balance.");
    }

    // Deduct
    user.balance -= plan.price;
    await user.save();

    // Check for existing active subscription
    const existingSub = await Subscription.findOne({
        userId: user._id,
        channelId: plan.channelId._id,
        status: 'active'
    });

    if (existingSub) {
        // Extend
        const now = new Date();
        let baseDate = new Date(existingSub.endDate);
        if (baseDate < now) baseDate = now;

        const newEndDate = new Date(baseDate);
        newEndDate.setMonth(newEndDate.getMonth() + plan.durationMonths);

        existingSub.endDate = newEndDate;
        existingSub.planId = plan._id;
        existingSub.notifiedWarning = false;
        existingSub.notifiedFinal = false;
        existingSub.notifiedExpired = false;
        await existingSub.save();
    } else {
        // Create Subscription
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + plan.durationMonths);

        await Subscription.create({
            userId: user._id,
            channelId: plan.channelId._id,
            planId: plan._id,
            startDate: new Date(),
            endDate: endDate,
            status: 'active'
        });
    }

    // Create Transaction Record
    await Transaction.create({
        fromUser: user._id,
        toUser: (plan.channelId as any).merchantId, // Pay to Merchant
        amount: plan.price,
        type: 'subscription',
        status: 'completed',
        details: `Sub: ${planName}`
    });

    // Generate Invite Link
    try {
        const invite = await ctx.api.createChatInviteLink((plan.channelId as any).channelId, {
            member_limit: 1,
            name: `Sub: ${user.firstName}` // Identify key
        });

        const actionVerbed = existingSub ? "renewed" : "purchased";
        const actionTitle = existingSub ? "Subscription Renewed!" : "Subscription Active!";

        await ctx.editMessageText(`✅ <b>${actionTitle}</b>\n\nYou have ${actionVerbed} <b>${planName}</b> for <b>${channelTitle}</b>.\n\n🔗 <a href="${invite.invite_link}">Join Channel Now</a>`, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("Failed to generate link:", e);
        await ctx.reply("Subscription active, but failed to generate link. Please contact admin.");
    }
}

export async function handleManageChannels(ctx: BotContext, page: number = 1) {
    const { default: MerchantChannel } = await import('@/models/MerchantChannel');
    const { default: SubscriptionPlan } = await import('@/models/SubscriptionPlan');
    const { InlineKeyboard } = await import('grammy');
    const { getPaginationKeyboard } = await import('./menus');
    const { t } = await import('@/lib/i18n'); // Ensure t is imported

    const user = ctx.user;
    const l = user.language as any;
    const loadingMsg = await ctx.reply("⏳ Loading Channels...");

    try {
        const PAGE_SIZE = 5;
        const skip = (page - 1) * PAGE_SIZE;

        const totalCount = await MerchantChannel.countDocuments({ merchantId: user._id, isActive: true });
        const totalPages = Math.ceil(totalCount / PAGE_SIZE);

        if (totalCount === 0) {
            const kb = new InlineKeyboard().text(t(l, 'channel_add_btn'), 'add_channel_start');
            await ctx.api.editMessageText(ctx.chat?.id!, loadingMsg.message_id, t(l, 'channel_list_empty'), { reply_markup: kb });
            return;
        }

        // Optimized: Single Query Aggregation
        // Fetches Channels + Plan Counts in one go.
        const channels = await MerchantChannel.aggregate([
            { $match: { merchantId: user._id, isActive: true } },
            { $skip: skip },
            { $limit: PAGE_SIZE },
            {
                $lookup: {
                    from: 'subscriptionplans', // Mongoose default collection name
                    let: { chId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $and: [{ $eq: ['$channelId', '$$chId'] }, { $eq: ['$isActive', true] }] } } },
                        { $count: 'count' }
                    ],
                    as: 'planStats'
                }
            },
            {
                $addFields: {
                    planCount: { $ifNull: [{ $arrayElemAt: ['$planStats.count', 0] }, 0] }
                }
            }
        ]);

        let msg = `<b>📢 Your Channels (Page ${page}/${totalPages})</b>\nSelect a channel to manage plans:\n`;

        // Dynamic Keyboard construction
        const kb = new InlineKeyboard();
        for (const ch of channels) {
            msg += `\n• <b>${ch.title}</b> (${ch.planCount} Plans)`;
            kb.text(ch.title, `manage_ch_${ch._id}`).row();
        }

        // Add Pagination Controls
        const paginationRow = getPaginationKeyboard(page, totalPages, 'channels');
        // Grammy's inline_keyboard is [][]InlineKeyboardButton
        if (paginationRow.inline_keyboard.length > 0) {
            const buttons = paginationRow.inline_keyboard[0]; // get the first row of buttons
            kb.row();
            // Append manually or use spread if API supports it, but .append takes ...buttons
            buttons.forEach(btn => kb.text(btn.text, (btn as any).callback_data || 'noop'));
        }

        kb.text(t(l, 'channel_add_btn'), 'add_channel_start').row();

        // If updated from callback (pagination), edit. If new, reply.
        // Since we sent a loading message, we always edit strictly speaking.
        await ctx.api.editMessageText(ctx.chat?.id!, loadingMsg.message_id, msg, { parse_mode: 'HTML', reply_markup: kb });

    } catch (error) {
        console.error("Manage Channels Error:", error);
        await ctx.api.editMessageText(ctx.chat?.id!, loadingMsg.message_id, "❌ Error loading channels.");
    }
}

export async function handleChannelDetails(ctx: BotContext, channelId: string) {
    const { default: MerchantChannel } = await import('@/models/MerchantChannel');
    const { default: SubscriptionPlan } = await import('@/models/SubscriptionPlan');
    const { t } = await import('@/lib/i18n');
    const l = ctx.user.language as any;
    const { InlineKeyboard } = await import('grammy');

    const ch = await MerchantChannel.findById(channelId);
    if (!ch) return ctx.reply("Channel not found.");

    const plans = await SubscriptionPlan.find({ channelId: ch._id, isActive: true });
    const botUsername = ctx.me.username;

    // ONE link per channel
    const shareLink = `https://t.me/${botUsername}?start=ch_${ch._id}`;

    let msg = `📢 <b>${ch.title}</b>\n\n`;
    msg += `🔗 <b>Share Link:</b>\n<code>${shareLink}</code>\n\n`;

    if (plans.length > 0) {
        msg += `<b>Active Plans (${plans.length}):</b>\n`;
        plans.forEach((p, i) => {
            msg += `${i + 1}. ${p.name || (p.durationMonths + ' Months')} - ${p.price.toLocaleString()} MMK\n`;
        });
    } else {
        msg += `⚠️ No plans created yet. Add a plan first.`;
    }

    const kb = new InlineKeyboard()
        .text(t(l, 'plan_add_btn'), `add_plan_${ch._id}`).row()
        .text("📋 Manage Plans", `manage_plans_${ch._id}`).row()
        .text("✏️ Edit Category", `edit_ch_cat_${ch._id}`).row()
        .text("🔙 Back", `admin_channels_back`);

    // Add category to message
    const catKey = `cat_${ch.category || 'other'}` as any;
    msg += `\n📁 <b>Category:</b> ${t(l, catKey)}`;

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
}

// Handle channel link (ch_CHANNELID) - shows plans to user
export async function handleChannelStart(ctx: BotContext, payload: string) {
    const channelId = payload.replace('ch_', '');

    const { default: MerchantChannel } = await import('@/models/MerchantChannel');
    const { default: SubscriptionPlan } = await import('@/models/SubscriptionPlan');
    const { InlineKeyboard } = await import('grammy');

    const ch = await MerchantChannel.findById(channelId);
    if (!ch) return ctx.reply("❌ Channel not found.");

    const plans = await SubscriptionPlan.find({ channelId: ch._id, isActive: true });

    if (plans.length === 0) {
        return ctx.reply("❌ No subscription plans available for this channel yet.");
    }

    let msg = `📢 <b>${ch.title}</b>\n\nChoose a subscription plan:\n`;

    const kb = new InlineKeyboard();

    plans.forEach((p) => {
        const label = `${p.name || (p.durationMonths + ' Months')} - ${p.price.toLocaleString()} MMK`;
        kb.text(label, `buy_sub_${p._id}`).row();
    });

    kb.text("❌ Cancel", "cancel_sub");

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
}

