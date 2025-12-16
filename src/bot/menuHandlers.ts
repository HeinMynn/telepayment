import { BotContext } from './types';
import { t } from '@/lib/i18n';
import { getMainMenu, getMerchantMenu, getInvoiceMenu, getInvoiceTypeMenu, getCancelKeyboard } from './menus';
import User from '@/models/User';

export async function handleMenuClick(ctx: BotContext) {
    const text = ctx.message?.text;
    if (!text) return;

    const user = ctx.user;
    const l = user.language as any;

    // Navigation Logic

    // 1. Main Menu -> Balance
    if (text === t(l, 'menu_balance')) {
        await ctx.reply(t(l, 'balance_text', { amount: user.balance.toLocaleString() }), {
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
    if (text === t(l, 'menu_topup')) {
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
}

export async function startTopupflow(ctx: BotContext) {
    const user = ctx.user;
    const l = user.language as any;
    const { getProviderKeyboard } = await import('./menus'); // Import local helper

    await ctx.reply(t(l, 'topup_intro'));
    await ctx.reply(t(l, 'select_provider_topup'), { reply_markup: getProviderKeyboard(user.language) });

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

    await ctx.replyWithPhoto(new InputFile('assets/guide_1.png'), {
        caption: t(l, 'onboard_cap_1'),
        parse_mode: 'Markdown',
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
        mediaPath = 'assets/guide_1.png';
        caption = t(l, 'onboard_cap_1');
        kb.text("Next ➡️", "onboard_2");
    } else if (step === '2') {
        mediaPath = 'assets/guide_2.png';
        caption = t(l, 'onboard_cap_2');
        kb.text("⬅️ Prev", "onboard_1").text("Next ➡️", "onboard_3");
    } else if (step === '3') {
        mediaPath = 'assets/guide_3.png';
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
            parse_mode: 'Markdown'
        }, { reply_markup: kb });
    } catch (e) { /* ignore */ }
}


