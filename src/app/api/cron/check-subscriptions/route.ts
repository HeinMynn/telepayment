import { NextResponse } from 'next/server';
import { bot } from '@/bot/bot';
import dbConnect from '@/lib/db';
import Subscription from '@/models/Subscription';
import MerchantChannel from '@/models/MerchantChannel';
import User from '@/models/User';
import { InlineKeyboard } from 'grammy';
import { t } from '@/lib/i18n';

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get('authorization');
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new Response('Unauthorized', { status: 401 });
        }

        await dbConnect();
        const now = new Date();

        // 1. Kick Expired Users (expired yesterday or earlier)
        const expiredSubs = await Subscription.find({
            status: 'active',
            endDate: { $lte: now }
        }).populate('channelId userId');

        for (const sub of expiredSubs) {
            const channel = sub.channelId as any;
            const user = sub.userId as any;

            if (channel && user) {
                try {
                    // Kick (Ban and Unban)
                    await bot.api.banChatMember(channel.channelId, user.telegramId);
                    await bot.api.unbanChatMember(channel.channelId, user.telegramId);

                    const kb = new InlineKeyboard().text("🔄 Renew Subscription", `renew_sub_${channel._id}`);
                    await bot.api.sendMessage(user.telegramId, `❌ **Subscription Expired**\n\nYou have been removed from <b>${channel.title}</b>.\nPlease renew to rejoin!`, { parse_mode: 'HTML', reply_markup: kb });

                    sub.status = 'expired';
                    sub.notifiedExpired = true;
                    await sub.save();
                } catch (e) {
                    console.error(`Failed to kick ${user.telegramId}:`, e);
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
                    console.error(`Failed to warn final ${user.telegramId}:`, e);
                }
            }
        }

        // 3. Early Warning (3 Days Before)
        // Check between 1 day and 3 days from now
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
                    console.error(`Failed to warn ${user.telegramId}:`, e);
                }
            }
        }

        return NextResponse.json({
            success: true,
            kicked: expiredSubs.length,
            finalWarn: finalSubs.length,
            earlyWarn: warningSubs.length
        });

    } catch (err: any) {
        console.error("Cron Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
