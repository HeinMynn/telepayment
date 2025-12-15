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
