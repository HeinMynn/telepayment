import { BotContext } from './types';
import { t } from '@/lib/i18n';
import MerchantChannel from '@/models/MerchantChannel';
import SubscriptionPlan from '@/models/SubscriptionPlan';
import Transaction from '@/models/Transaction';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import { InlineKeyboard } from 'grammy';
import { getMerchantMenu, getCancelKeyboard, getMainMenu } from './menus';
import mongoose from 'mongoose';

export async function handleManageChannel(ctx: BotContext, channelId: string) {
    const user = ctx.user;
    const l = user.language as any;

    // channelId is the Telegram Chat ID (Number)
    const channel = await MerchantChannel.findOne({ channelId: parseInt(channelId) });
    if (!channel) return ctx.reply("Channel not found.");
    if (String(channel.merchantId) !== String(user._id)) return ctx.reply("Not your channel.");

    // Fetch Plans
    const plans = await SubscriptionPlan.find({ channelId: channel._id, isActive: true });

    // Generate Deep Link
    const botUsername = ctx.me.username;
    // Use mongo ID for cleaner internal ref, but we used channelId (Tele ID) in other places?
    // handleSubscriptionStart uses 'sub_{mongoId}' or 'sub_{teleId}'?
    // Let's check handleSubscriptionStart: `channelId = payload.replace('sub_', '')`.
    // Then `MerchantChannel.findById(channelId)`.
    // So it expects Mongo ID.
    const subLink = `https://t.me/${botUsername}?start=sub_${channel._id}`;

    let msg = t(l, 'plan_menu_title').replace('{channel}', channel.title) + "\n";
    msg += `🔗 Link: ${subLink}\n\n`;

    if (plans.length === 0) {
        msg += "No plans created.";
    } else {
        plans.forEach((p, i) => {
            msg += `${i + 1}. ${p.durationMonths} Months - ${p.price.toLocaleString()} MMK\n`;
        });
    }

    // Keyboard: Add Plan, Back
    const kb = new InlineKeyboard()
        .text(t(l, 'plan_add_btn'), `add_plan_${channel._id}`).row()
        .text(t(l, 'back_merchant'), 'merchant_menu_channels'); // Back to Channel List

    // Edit message if callback, Reply if text (unlikely)
    if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { reply_markup: kb });
    } else {
        await ctx.reply(msg, { reply_markup: kb });
    }
}

export async function handleAddPlan(ctx: BotContext, channelId: string) {
    const user = ctx.user;
    const l = user.language as any;

    // Ask for Duration
    const { InlineKeyboard } = await import('grammy');
    const kb = new InlineKeyboard()
        .text("1 Month", `plan_dur_1_${channelId}`)
        .text("3 Months", `plan_dur_3_${channelId}`).row()
        .text("6 Months", `plan_dur_6_${channelId}`)
        .text("12 Months", `plan_dur_12_${channelId}`).row()
        .text(t(l, 'cancel'), 'cancel_plan_add');

    await ctx.editMessageText(t(l, 'plan_duration_prompt'), { reply_markup: kb });
}

export async function handleSubscriptionStart(ctx: BotContext, payload: string) {
    const channelId = payload.replace('sub_', '');
    console.log("Sub Start for Channel ID:", channelId);

    const user = ctx.user;
    const l = user.language as any;

    let channel;
    try {
        channel = await MerchantChannel.findById(channelId);
    } catch (e) { console.error("Invalid ID", e); return ctx.reply("Invalid Link"); }

    if (!channel) {
        console.log("Channel not found in DB");
        return ctx.reply("Channel not found or deleted.");
    }

    const plans = await SubscriptionPlan.find({ channelId: channel._id, isActive: true }).sort({ price: 1 });
    console.log("Plans found:", plans.length);

    if (plans.length === 0) return ctx.reply("No active plans for this channel.");

    let msg = t(l, 'sub_intro', { channel: channel.title });
    const kb = new InlineKeyboard();

    plans.forEach(p => {
        kb.text(t(l, 'sub_plan_btn', { duration: p.durationMonths, price: p.price.toLocaleString() }), `buy_plan_${p._id}`).row();
    });

    await ctx.reply(msg, { reply_markup: kb, parse_mode: 'Markdown' });
}

export async function handleBuyPlan(ctx: BotContext, planId: string) {
    const user = ctx.user;
    const l = user.language as any;

    const plan = await SubscriptionPlan.findById(planId).populate('channelId');
    if (!plan) return ctx.reply("Plan not found.");
    const channel = plan.channelId as any; // Type assertion

    // Check Balance
    if (user.balance < plan.price) {
        const kb = new InlineKeyboard()
            .text(t(l, 'menu_topup'), 'start_topup_flow');
        await ctx.reply(t(l, 'sub_fail_balance') + `\nRequired: ${plan.price}, Have: ${user.balance}`, { reply_markup: kb });
        return;
    }

    // Confirm
    const kb = new InlineKeyboard()
        .text(t(l, 'pay_confirm'), `confirm_sub_${plan._id}`).row()
        .text(t(l, 'cancel'), 'cancel_sub');

    await ctx.reply(t(l, 'sub_confirm', { price: plan.price.toLocaleString() }), { reply_markup: kb });
}

export async function handleConfirmSub(ctx: BotContext, planId: string) {
    try {
        const user = ctx.user;
        const l = user.language as any;
        console.log(`Processing sub for plan ${planId} by user ${user.telegramId}`);

        const plan = await SubscriptionPlan.findById(planId).populate('channelId');
        if (!plan) return ctx.reply("Plan not found.");
        const channel = plan.channelId as any;

        // Atomic Purchase
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            // Re-check balance in transaction
            const freshUser = await User.findById(user._id).session(session);
            if (!freshUser || freshUser.balance < plan.price) {
                throw new Error("Insufficient Balance");
            }

            // 1. Create Transaction (User -> Merchant)
            // Platform fee? User prompt didn't mention fee. Assuming Direct. 
            // Or User -> Platform? 
            // Let's do User -> Merchant. 
            // Wait, does Merchant get funds?
            // "Deduct the price from the user balance." 
            // Presumably credited to merchant?
            // Yes.
            const merchant = await User.findById(channel.merchantId).session(session);
            if (!merchant) throw new Error("Merchant not found");

            const tx = await Transaction.create([{
                fromUser: freshUser._id,
                toUser: merchant._id,
                amount: plan.price,
                type: 'subscription', // need to add to enum or loose? enum in schema usually.
                status: 'completed',
                // description: `Sub: ${channel.title}`
            }], { session });

            // 2. Update Balances
            freshUser.balance -= plan.price;
            merchant.balance += plan.price; // Merchant gets funds immediately? Or pending?
            // User prompt: "Deduct from user balance".
            // Let's assume transfer.
            await freshUser.save();
            await merchant.save();

            // 3. Create or Extend Subscription
            // Check for existing active subscription (or recently expired if we want to allow gap filling? No, user said 'active' extension).
            // Actually, if status is 'active', it means not yet expired (or cron hasn't run).
            const existingSub = await Subscription.findOne({
                userId: freshUser._id,
                channelId: channel._id,
                status: 'active'
            }).session(session);

            if (existingSub) {
                // Extend
                const now = new Date();
                let baseDate = existingSub.endDate;
                if (baseDate < now) baseDate = now; // If technically passed but status active, extend from now or end date? 
                // Usually extend from end date if active.
                // But if negative? i.e. endDate was yesterday, but status still active.
                // "expiry date dec 15. early renew dec 12 -> Jan 15".
                // If renew dec 16 (expired but cron missed?), endDate -> Jan 15? (Gap fill?)
                // User requirement implies "Previous subscription should extend".
                // If it's active, we extend from endDate.

                const newEndDate = new Date(baseDate);
                newEndDate.setMonth(newEndDate.getMonth() + plan.durationMonths);

                existingSub.endDate = newEndDate;
                existingSub.planId = plan._id;
                existingSub.paymentTxId = tx[0]._id;
                existingSub.notifiedWarning = false;
                existingSub.notifiedFinal = false;
                existingSub.notifiedExpired = false;

                await existingSub.save({ session });
            } else {
                // New Subscription
                const startDate = new Date();
                const endDate = new Date();
                endDate.setMonth(endDate.getMonth() + plan.durationMonths);

                await Subscription.create([{
                    userId: freshUser._id,
                    channelId: channel._id,
                    planId: plan._id,
                    startDate,
                    endDate,
                    status: 'active',
                    paymentTxId: tx[0]._id
                }], { session });
            }

            await session.commitTransaction();
        } catch (e) {
            await session.abortTransaction();
            await ctx.reply("Transaction failed: " + e);
            return;
        } finally {
            session.endSession();
        }

        // 4. Generate Invite Link (Non-atomic, Telegram API)
        try {
            // Expire invite link in 24 hours
            // Channel ID?
            const chatInvite = await ctx.api.createChatInviteLink(channel.channelId, {
                member_limit: 1,
                expire_date: Math.floor(Date.now() / 1000) + 86400 // 24h
                // name?
            });

            // Channel Direct Link removed: user wants it after joining.
            await ctx.reply(t(l, 'sub_success').replace('{link}', chatInvite.invite_link));
        } catch (e) {
            console.error("Invite Gen Error:", e);
            await ctx.reply("✅ Payment successful, but error generating link. Please contact admin/merchant.");
        }
    } catch (outerErr) {
        console.error("Critical Sub Error:", outerErr);
        await ctx.reply("An unexpected error occurred processing your subscription.");
    }
}
