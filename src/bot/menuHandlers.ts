import { BotContext } from './types';
import { t } from '@/lib/i18n';
import { getMainMenu, getMerchantMenu, getInvoiceMenu, getInvoiceTypeMenu, getCancelKeyboard } from './menus';
import User from '@/models/User';
import path from 'path';

export async function handleMenuClick(ctx: BotContext) {
    const text = ctx.message?.text;
    if (!text) return;

    const user = ctx.user;
    const l = user.language as any;

    // Navigation Logic

    // 1. Main Menu -> Balance
    if (text === t(l, 'menu_balance') || text === t(l, 'balance_btn') || text.includes('Balance')) {
        let balanceMsg: string;
        const frozenBalance = user.frozenBalance || 0;

        if (user.role === 'merchant') {
            // Query pending escrow from subscriptions for this merchant's channels
            const { default: MerchantChannel } = await import('@/models/MerchantChannel');
            const { default: Subscription } = await import('@/models/Subscription');

            const channels = await MerchantChannel.find({ merchantId: user._id });
            const channelIds = channels.map(c => c._id);

            // Get unreleased escrow subscriptions (escrowReleased: false OR not set)
            const pendingSubs = await Subscription.find({
                channelId: { $in: channelIds },
                $or: [
                    { escrowReleased: false },
                    { escrowReleased: { $exists: false } }
                ],
                disputed: { $ne: true },
                escrowAmount: { $gt: 0 }
            });

            const pendingBalance = pendingSubs.reduce((sum, sub) => sum + (sub.escrowAmount || 0), 0);
            const pendingCount = pendingSubs.length;

            // Calculate days range for pending
            const now = new Date();
            let pendingInfo = '';
            if (pendingCount > 0) {
                const maxDays = Math.max(...pendingSubs.map(sub => {
                    const releaseAt = new Date(sub.escrowReleaseAt || now);
                    return Math.max(0, Math.ceil((releaseAt.getTime() - now.getTime()) / (1000 * 3600 * 24)));
                }));
                pendingInfo = ` (${pendingCount} subs, ${maxDays} days)`;
            }

            const total = user.balance + pendingBalance + frozenBalance;
            balanceMsg = `💰 <b>Your Balance</b>\n\n💵 Available: <b>${user.balance.toLocaleString()} MMK</b>\n⏳ Pending: <b>${pendingBalance.toLocaleString()} MMK</b>${pendingInfo}`;
            if (frozenBalance > 0) {
                balanceMsg += `\n🔒 Frozen: <b>${frozenBalance.toLocaleString()} MMK</b>`;
            }
            balanceMsg += `\n━━━━━━━━━━━━━━━\n💰 Total: <b>${total.toLocaleString()} MMK</b>`;
        } else {
            balanceMsg = `💰 Your Balance: <b>${user.balance.toLocaleString()} MMK</b>`;
        }

        await ctx.reply(balanceMsg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: t(l, 'menu_topup'), callback_data: 'start_topup_flow' }],
                    [{ text: t(l, 'withdraw_btn'), callback_data: 'withdraw_start' }]
                ]
            }
        });
        return;
    }

    // 2. Main Menu -> Topup
    if (text === t(l, 'topup_btn') || text === t(l, 'menu_topup') || text.includes('Top Up') || text.includes('Top up')) {
        return startTopupflow(ctx);
    }

    // 3. Main Menu -> My Subscriptions
    // 3. Main Menu -> My Subscriptions
    // Use dynamic key or explicit matching
    if (text === t(l, 'my_subs_btn') || text === "📅 My Subscriptions" || text.includes("My Subscriptions")) {
        const loading = await ctx.reply("⏳ Loading...");
        const { showUserSubscriptions } = await import('./subscriptionHandlers');

        // Artificial delay so user sees "Loading"
        await new Promise(r => setTimeout(r, 800));

        await showUserSubscriptions(ctx, 1, loading.message_id);
        return;
    }

    // Main Menu -> Explore
    if (text === t(l, 'explore_btn') || text === "🔍 Explore" || text.includes("Explore")) {
        const { InlineKeyboard } = await import('grammy');
        const MerchantChannel = (await import('@/models/MerchantChannel')).default;

        // Get popular channels (not expired)
        const now = new Date();
        const popular = await MerchantChannel.find({
            isActive: true,
            isPopular: true,
            $or: [{ popularExpiresAt: { $gt: now } }, { popularExpiresAt: null }]
        }).limit(10);

        let msg = t(l, 'explore_title');
        const kb = new InlineKeyboard();

        // Add Popular button at top if any exist
        if (popular.length > 0) {
            kb.text(`🔥 Popular Channels`, 'explore_popular').row();
        }

        kb.text(t(l, 'cat_entertainment'), 'explore_cat_entertainment').text(t(l, 'cat_education'), 'explore_cat_education').row()
            .text(t(l, 'cat_business'), 'explore_cat_business').text(t(l, 'cat_gaming'), 'explore_cat_gaming').row()
            .text(t(l, 'cat_lifestyle'), 'explore_cat_lifestyle').text(t(l, 'cat_other'), 'explore_cat_other').row()
            .text(t(l, 'cat_all'), 'explore_cat_all').row()
            .text('❤️ My Favourites', 'my_favourites');

        await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
        return;
    }

    // 4. Main Menu -> History (Transactions)
    if (text === t(l, 'menu_history')) {
        await showHistory(ctx, 1);
        return;
    }

    // 4. Main Menu -> Settings
    if (text === t(l, 'settings_btn')) {
        await showSettings(ctx);
        return;
    }

    // 5. Main Menu -> Merchant
    if (text === t(l, 'menu_merchant')) {
        if (user.role !== 'merchant') return;
        await ctx.reply("Merchant Menu:", { reply_markup: getMerchantMenu(user.language) });
        return;
    }

    // 4. Back
    if (text === t(l, 'back_main')) {
        await ctx.reply("Main Menu:", { reply_markup: getMainMenu(user.role, user.language) });
        return;
    }

    // 5. Merchant -> Invoices
    if (text === t(l, 'merchant_menu_invoice')) {
        await ctx.reply("Invoices:", { reply_markup: getInvoiceMenu(user.language) });
        return;
    }

    // 6. Merchant -> Report
    if (text === t(l, 'merchant_menu_report')) {
        const { default: Transaction } = await import('@/models/Transaction');

        // Aggregate Total Income
        // pending, completed? Only completed.
        const stats = await Transaction.aggregate([
            { $match: { toUser: user._id, type: 'payment', status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        if (stats.length === 0) {
            await ctx.reply("No income yet.");
        } else {
            const total = stats[0].total.toLocaleString();
            await ctx.reply(`📊 <b>Merchant Report</b>\n\nTotal Income: ${total} MMK\nTransactions: ${stats[0].count}`, { parse_mode: 'HTML' });
        }
        return;
    }

    // 7. Merchant -> Edit Name
    if (text === t(l, 'merchant_menu_edit_name')) {
        await ctx.reply(t(l, 'merchant_edit_name_prompt'), { reply_markup: getCancelKeyboard(user.language) });
        user.interactionState = 'awaiting_business_name';
        await user.save();
        return;
    }

    // 8. Merchant -> Manage Channels
    if (text === t(l, 'merchant_menu_channels')) {
        const { handleManageChannels } = await import('./subscriptionHandlers');
        return handleManageChannels(ctx);
    }

    // 7. Merchant -> Edit Name
    if (text === t(l, 'settings_add_account')) {
        const { getProviderKeyboard } = await import('./menus');
        await ctx.reply(t(l, 'select_provider'), { reply_markup: getProviderKeyboard(user.language) });
        user.interactionState = 'awaiting_payment_provider';
        await user.save();
        return;
    }

    // 7. Invoices -> Create
    if (text === t(l, 'invoice_create')) {
        await ctx.reply(t(l, 'select_invoice_type'), { reply_markup: getInvoiceTypeMenu(user.language) });
        user.interactionState = 'selecting_invoice_type_create';
        await user.save();
        return;
    }

    // 7. Invoices -> View
    if (text === t(l, 'invoice_view')) {
        await ctx.reply(t(l, 'select_invoice_type'), { reply_markup: getInvoiceTypeMenu(user.language) });
        user.interactionState = 'selecting_invoice_type_view';
        await user.save();
        return;
    }

    // 4. Navigation Back Handlers
    // 8. Merchant -> Channels
    if (text === t(l, 'merchant_menu_channels')) {
        const { default: MerchantChannel } = await import('@/models/MerchantChannel');
        const channels = await MerchantChannel.find({ merchantId: user._id, isActive: true });

        const { InlineKeyboard, InputFile } = await import('grammy');
        const kb = new InlineKeyboard();

        if (channels.length > 0) {
            channels.forEach(ch => {
                kb.text(ch.title, `manage_channel_${ch.channelId}`).row();
            });
        }
        kb.text(t(l, 'channel_add_btn'), 'add_channel_start');

        const msg = channels.length > 0 ? t(l, 'merchant_menu_channels') : t(l, 'channel_list_empty');
        await ctx.reply(msg, { reply_markup: kb });
        return;
    }

    // Navigation Back Handlers

    // Switch to User (Main Menu)
    if (text === t(l, 'switch_to_user')) {
        await ctx.reply("Switched to User Mode.", { reply_markup: getMainMenu(user.role, user.language) });
        return;
    }

    // Activity Log
    if (text === "📜 Activity Log") {
        const { default: AuditLog } = await import('@/models/AuditLog');
        const logs = await AuditLog.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20);

        if (logs.length === 0) {
            await ctx.reply("📜 <b>Activity Log</b>\n\nNo activity recorded yet.", { parse_mode: 'HTML' });
            return;
        }

        let msg = "📜 <b>Activity Log</b>\n\nRecent actions:\n";

        const actionLabels: Record<string, string> = {
            'plan_created': '➕ Created plan',
            'plan_price_changed': '💰 Changed price',
            'plan_toggled': '🔄 Toggled plan',
            'channel_added': '📢 Added channel',
            'channel_category_changed': '📁 Changed category',
            'account_added': '💳 Added account',
            'account_removed': '🗑 Removed account'
        };

        logs.forEach((log: any) => {
            const date = new Date(log.createdAt).toLocaleDateString();
            const time = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const label = actionLabels[log.action] || log.action;

            let detail = '';
            if (log.details) {
                if (log.action === 'plan_price_changed') {
                    detail = `: ${log.details.oldPrice?.toLocaleString()} → ${log.details.newPrice?.toLocaleString()} MMK`;
                } else if (log.action === 'plan_toggled') {
                    detail = `: ${log.details.isActive ? 'Enabled' : 'Disabled'}`;
                } else if (log.action === 'channel_category_changed') {
                    detail = `: ${log.details.oldCategory} → ${log.details.newCategory}`;
                } else if (log.details.channelTitle || log.details.planName) {
                    detail = `: ${log.details.channelTitle || log.details.planName}`;
                }
            }

            msg += `\n<code>${date} ${time}</code> ${label}${detail}`;
        });

        await ctx.reply(msg, { parse_mode: 'HTML' });
        return;
    }

    // Back to Merchant
    if (text === t(l, 'back_merchant')) {
        await ctx.reply("Merchant Menu:", { reply_markup: getMerchantMenu(user.language) });
        return;
    }

    // 9. How to Use
    if (text === t(l, 'how_to_use_btn')) {
        await sendVisualOnboarding(ctx);
        return;
    }

    // 10. Invite Friends
    if (text === t(l, 'invite_btn')) {
        if (!ctx.me?.username) return;
        const link = `https://t.me/${ctx.me.username}?start=ref_${user.telegramId}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me on this awesome payment bot!')}`;

        const { InlineKeyboard } = await import('grammy');
        const kb = new InlineKeyboard().url('📤 Share with Friends', shareUrl);

        await ctx.reply(`🎁 <b>Invite Friends & Earn!</b>\n\nShare this link. When a friend joins and makes their FIRST top-up, you earn <b>1%</b> of the amount!\n\n🔗 Your Link:\n<blockquote><code>${link}</code></blockquote>`, {
            parse_mode: 'HTML',
            reply_markup: kb
        });
        return;
    }

    // 11. Leaderboard
    if (text === t(l, 'leaderboard_btn')) {
        await showLeaderboard(ctx);
        return;
    }
}

export async function startTopupflow(ctx: BotContext) {
    const user = ctx.user;
    const l = user.language as any;
    const { getProviderKeyboard } = await import('./menus'); // Import local helper

    await ctx.reply(t(l, 'topup_intro'), { parse_mode: 'HTML' });
    await ctx.reply(t(l, 'select_provider_topup'), { reply_markup: getProviderKeyboard(user.language), parse_mode: 'HTML' });

    // Set State
    user.interactionState = 'awaiting_topup_provider';
    await user.save();
}

export async function showHistory(ctx: BotContext, page: number) {
    const { default: Transaction } = await import('@/models/Transaction');
    const { getPaginationKeyboard } = await import('./menus');

    const user = ctx.user;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    // Filter: Involved User
    const filter = { $or: [{ fromUser: user._id }, { toUser: user._id }] };

    const totalCount = await Transaction.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalCount === 0) {
        if (page === 1) await ctx.reply("No history found.");
        else await ctx.answerCallbackQuery("No more history.");
        return;
    }

    const txs = await Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize);

    let report = `📜 <b>History (Page ${page}/${totalPages})</b>\n`;
    txs.forEach(tx => {
        const date = new Date(tx.createdAt).toLocaleDateString();

        // Status Icons
        let statusIcon = '⏳'; // pending
        if (tx.status === 'completed' || tx.status === 'approved') statusIcon = '✅';
        else if (tx.status === 'rejected' || tx.status === 'failed') statusIcon = '❌';

        // Direction Logic
        const userIdStr = user._id.toString();
        const fromIdStr = tx.fromUser ? tx.fromUser.toString() : '';
        const toIdStr = tx.toUser ? tx.toUser.toString() : '';

        let dirIcon = '';
        let sign = '';

        // Explicit Types
        if (tx.type === 'topup') {
            dirIcon = '📥';
            sign = '+';
        }
        else if (tx.type === 'withdraw') {
            dirIcon = '📤';
            sign = '-';
        }
        else {
            // P2P or Subscription
            if (toIdStr === userIdStr) {
                dirIcon = '📥';
                sign = '+';
            } else {
                dirIcon = '📤';
                sign = '-';
            }
        }

        report += `\n${statusIcon} <b>${(tx.type || 'TX').toUpperCase()}</b> ${dirIcon}`;
        report += `\n📅 ${date} | 💸 ${sign}${tx.amount.toLocaleString()} MMK`;
        report += `\n`;
    });

    const kb = getPaginationKeyboard(page, totalPages, 'history');

    // If new message (Menu Click) -> Reply
    // If pagination callback -> Edit
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

export async function showSettings(ctx: BotContext) {
    const user = ctx.user;
    const l = user.language as any;
    const { t } = await import('@/lib/i18n'); // ensure t is available
    const { InlineKeyboard } = await import('grammy');

    // Show current accounts
    let msg = "⚙️ <b>Settings</b>\n\nPayment Accounts:\n";
    if (user.paymentMethods && user.paymentMethods.length > 0) {
        user.paymentMethods.forEach((pm: any, i: number) => {
            msg += `${i + 1}. ${pm.provider} - ${pm.accountNumber}\n`;
        });
    } else {
        msg += "None set.\n";
    }

    const kb = new InlineKeyboard()
        .text(t(l, 'settings_add_account'), 'add_payment_account').row()
        .text(t(l, 'settings_remove_account'), 'remove_payment_account_menu');

    // If called from callback, edit. If message, reply.
    if (ctx.callbackQuery) {
        // Need to catch "not modified"
        try {
            await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: 'HTML' });
        } catch (e) { await ctx.answerCallbackQuery(); }
    } else {
        await ctx.reply(msg, { reply_markup: kb, parse_mode: 'HTML' });
    }
}

export async function sendVisualOnboarding(ctx: BotContext) {
    const { InputFile, InlineKeyboard } = await import('grammy');
    const { t } = await import('@/lib/i18n');
    const l = ctx.user.language as any;

    // Step 1: Send Image 1 with 'Next' button
    const kb = new InlineKeyboard().text("Next ➡️", "onboard_2");

    await ctx.replyWithPhoto(new InputFile(path.join(process.cwd(), 'assets/guide_1.png')), {
        caption: t(l, 'onboard_cap_1'),
        parse_mode: 'HTML',
        reply_markup: kb
    });
}

export async function handleOnboardingCallback(ctx: BotContext, step: string) {
    const { InputFile, InlineKeyboard } = await import('grammy');
    const { t } = await import('@/lib/i18n');
    const l = ctx.user.language as any;

    let mediaPath = '';
    let caption = '';
    let kb = new InlineKeyboard();

    if (step === '1') {
        mediaPath = path.join(process.cwd(), 'assets/guide_1.png');
        caption = t(l, 'onboard_cap_1');
        kb.text("Next ➡️", "onboard_2");
    } else if (step === '2') {
        mediaPath = path.join(process.cwd(), 'assets/guide_2.png');
        caption = t(l, 'onboard_cap_2');
        kb.text("⬅️ Prev", "onboard_1").text("Next ➡️", "onboard_3");
    } else if (step === '3') {
        mediaPath = path.join(process.cwd(), 'assets/guide_3.png');
        caption = t(l, 'onboard_cap_3');
        kb.text("⬅️ Prev", "onboard_2").text("Done ✅", "onboard_done");
    } else if (step === 'done') {
        await ctx.deleteMessage();
        return;
    }

    try {
        await ctx.editMessageMedia({
            type: 'photo',
            media: new InputFile(mediaPath),
            caption: caption,
            parse_mode: 'HTML'
        }, { reply_markup: kb });
    } catch (e) { /* ignore */ }
}

export async function showLeaderboard(ctx: BotContext) {
    const { default: User } = await import('@/models/User');
    const { default: Transaction } = await import('@/models/Transaction');
    const currentUser = ctx.user;

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Aggregate: Count referral bonus transactions per referrer (this month)
    // Each 'referral' type transaction represents a successful referral claim
    const leaderboard = await Transaction.aggregate([
        {
            $match: {
                type: 'referral',
                createdAt: { $gte: startOfMonth }
            }
        },
        { $group: { _id: '$toUser', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
    ]);

    // Get user details for display
    const referrerIds = leaderboard.map(e => e._id);
    const referrers = await User.find({ _id: { $in: referrerIds } });
    const referrerMap = new Map(referrers.map(r => [r._id.toString(), r]));

    // Build display
    let msg = `🏆 <b>Top Referrers - ${monthName}</b>\n\n`;

    if (leaderboard.length === 0) {
        msg += 'No successful referrals yet this month. Be the first!\n';
    } else {
        const badges = ['🥇', '🥈', '🥉'];
        leaderboard.forEach((entry, i) => {
            const referrer = referrerMap.get(entry._id.toString());
            const displayName = maskUsername(referrer?.username, referrer?.firstName);
            const badge = badges[i] || `${i + 1}.`;
            msg += `${badge} ${displayName} - <b>${entry.count}</b> referrals\n`;
        });
    }

    // User's own rank (this month)
    const userRankData = await Transaction.aggregate([
        {
            $match: {
                type: 'referral',
                createdAt: { $gte: startOfMonth }
            }
        },
        { $group: { _id: '$toUser', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]);

    const userRank = userRankData.findIndex(e => e._id.toString() === currentUser._id.toString());
    const userCount = userRank >= 0 ? userRankData[userRank].count : 0;

    msg += `\n<i>Your Rank: ${userRank >= 0 ? `#${userRank + 1}` : 'Unranked'} (${userCount} this month)</i>`;

    await ctx.reply(msg, { parse_mode: 'HTML' });
}

function maskUsername(username?: string, firstName?: string): string {
    if (username && username.length > 0) {
        const visible = username.slice(0, 3);
        return `@${visible}*****`;
    }
    if (firstName && firstName.length > 0) {
        const visible = firstName.slice(0, 3);
        return `${visible}*****`;
    }
    return 'User*****';
}
