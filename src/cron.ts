import Subscription from './models/Subscription';
import { bot } from './bot/bot';
import { InlineKeyboard } from 'grammy';

export async function runSubscriptionCron() {
    console.log('[Cron] Running subscription check...');
    const now = new Date();

    try {
        // 1. Kick Expired Users
        const expiredSubs = await Subscription.find({
            status: 'active',
            endDate: { $lte: now }
        }).populate('channelId userId');

        for (const sub of expiredSubs) {
            const channel = sub.channelId as any;
            const user = sub.userId as any;

            if (channel && user) {
                try {
                    await bot.api.banChatMember(channel.channelId, user.telegramId);
                    await bot.api.unbanChatMember(channel.channelId, user.telegramId);

                    const kb = new InlineKeyboard().text("🔄 Renew Subscription", `renew_sub_${channel._id}`);
                    await bot.api.sendMessage(user.telegramId, `❌ **Subscription Expired**\n\nYou have been removed from <b>${channel.title}</b>.\nPlease renew to rejoin!`, { parse_mode: 'HTML', reply_markup: kb });

                    sub.status = 'expired';
                    sub.notifiedExpired = true;
                    await sub.save();
                } catch (e) {
                    console.error(`[Cron] Failed to kick ${user.telegramId}:`, e);
                }
            } else {
                sub.status = 'expired';
                await sub.save();
            }
        }

        // 2. Final Warning (Less than 24 hours left)
        const oneDayFromNow = new Date();
        oneDayFromNow.setDate(now.getDate() + 1);

        const finalSubs = await Subscription.find({
            status: 'active',
            endDate: { $lte: oneDayFromNow, $gt: now },
            notifiedFinal: { $ne: true }
        }).populate('channelId userId');

        for (const sub of finalSubs) {
            const channel = sub.channelId as any;
            const user = sub.userId as any;

            if (channel && user) {
                try {
                    const kb = new InlineKeyboard().text("🔄 Renew Subscription", `renew_sub_${channel._id}`);
                    await bot.api.sendMessage(user.telegramId, `🚨 **Final Warning**\n\nYour subscription to <b>${channel.title}</b> expires in less than 24 hours!\nRenew IMMEDIATELY to avoid being kicked.`, { parse_mode: 'HTML', reply_markup: kb });

                    sub.notifiedFinal = true;
                    await sub.save();
                } catch (e) {
                    console.error(`[Cron] Failed to warn final ${user.telegramId}:`, e);
                }
            }
        }

        // 3. Early Warning (3 Days Before)
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(now.getDate() + 3);

        const warningSubs = await Subscription.find({
            status: 'active',
            endDate: { $lte: threeDaysFromNow, $gt: oneDayFromNow },
            notifiedWarning: { $ne: true }
        }).populate('channelId userId');

        for (const sub of warningSubs) {
            const channel = sub.channelId as any;
            const user = sub.userId as any;

            if (channel && user) {
                try {
                    const daysLeft = Math.ceil((new Date(sub.endDate).getTime() - now.getTime()) / (1000 * 3600 * 24));
                    const kb = new InlineKeyboard().text("🔄 Renew Subscription", `renew_sub_${channel._id}`);
                    await bot.api.sendMessage(user.telegramId, `⚠️ **Renewal Reminder**\n\nYour subscription to <b>${channel.title}</b> expires in ${daysLeft} days.`, { parse_mode: 'HTML', reply_markup: kb });

                    sub.notifiedWarning = true;
                    await sub.save();
                } catch (e) {
                    console.error(`[Cron] Failed to warn ${user.telegramId}:`, e);
                }
            }
        }

        console.log(`[Cron] Done: kicked=${expiredSubs.length}, finalWarn=${finalSubs.length}, earlyWarn=${warningSubs.length}`);
    } catch (err) {
        console.error('[Cron] Error:', err);
    }
}
