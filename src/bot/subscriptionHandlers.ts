import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import { getPaginationKeyboard } from './menus';
import { t } from '@/lib/i18n';

export async function showUserSubscriptions(ctx: BotContext, page: number) {
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
        if (page === 1) await ctx.reply(t(l, 'no_subs'));
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
        `Plan: ${plan.name} (${plan.durationDays} days)\n` +
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

    const user = await User.findById(ctx.user._id); // Refresh user
    if (!user) return;

    if (user.balance < plan.price) {
        return ctx.answerCallbackQuery("Insufficient Balance.");
    }

    // Deduct
    user.balance -= plan.price;
    await user.save();

    // Create Subscription
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    await Subscription.create({
        userId: user._id,
        channelId: plan.channelId._id,
        planId: plan._id,
        startDate: new Date(),
        endDate: endDate,
        status: 'active'
    });

    // Create Transaction Record
    await Transaction.create({
        fromUser: user._id,
        toUser: (plan.channelId as any).merchantId, // Pay to Merchant
        amount: plan.price,
        type: 'subscription',
        status: 'completed',
        details: `Sub: ${plan.name}`
    });

    // Generate Invite Link
    try {
        const invite = await ctx.api.createChatInviteLink((plan.channelId as any).channelId, {
            member_limit: 1,
            name: `Sub: ${user.firstName}` // Identify key
        });

        await ctx.editMessageText(`✅ <b>Subscription Active!</b>\n\nYou have purchased <b>${plan.name}</b>.\n\n🔗 <a href="${invite.invite_link}">Join Channel Now</a>`, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("Failed to generate link:", e);
        await ctx.reply("Subscription active, but failed to generate link. Please contact admin.");
    }
}

export async function handleManageChannels(ctx: BotContext) {
    const { default: MerchantChannel } = await import('@/models/MerchantChannel');
    const { default: SubscriptionPlan } = await import('@/models/SubscriptionPlan');
    const { t } = await import('@/lib/i18n');
    const l = ctx.user.language as any;
    const { InlineKeyboard } = await import('grammy');

    const channels = await MerchantChannel.find({ merchantId: ctx.user._id, isActive: true });

    if (channels.length === 0) {
        const kb = new InlineKeyboard().text(t(l, 'channel_add_btn'), 'add_channel');
        await ctx.reply(t(l, 'channel_list_empty'), { reply_markup: kb });
        return;
    }

    let msg = `<b>📢 Your Channels</b>\nSelect a channel to manage plans:\n`;
    const kb = new InlineKeyboard();

    for (const ch of channels) {
        const planCount = await SubscriptionPlan.countDocuments({ channelId: ch._id, isActive: true });
        msg += `\n• <b>${ch.title}</b> (${planCount} Plans)`;
        kb.text(ch.title, `manage_ch_${ch._id}`).row();
    }

    kb.text(t(l, 'channel_add_btn'), 'add_channel').row();

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
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

    let msg = `📢 <b>${ch.title}</b>\n\n`;
    const botUsername = ctx.me.username;

    if (plans.length > 0) {
        msg += `<b>Active Plans:</b>\n`;
        plans.forEach((p, i) => {
            const link = `https://t.me/${botUsername}?start=sub_${p._id}`;
            msg += `\n${i + 1}. <b>${p.name || (p.durationMonths + ' Months')}</b> - ${p.price.toLocaleString()} MMK\n`;
            msg += `🔗 Link: <code>${link}</code>\n`;
        });
    } else {
        msg += `No plans created yet.`;
    }

    const kb = new InlineKeyboard()
        .text(t(l, 'plan_add_btn'), `add_plan_${ch._id}`).row()
        .text("🔙 Back", `admin_channels_back`); // or merchant_manage_channels implicitly

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
}
