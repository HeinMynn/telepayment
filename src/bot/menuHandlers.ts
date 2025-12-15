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
    if (text === "📅 My Subscriptions") {
        const { default: Subscription } = await import('@/models/Subscription');
        const { default: MerchantChannel } = await import('@/models/MerchantChannel'); // Ensure population works

        const subs = await Subscription.find({ userId: user._id }).populate('channelId').sort({ endDate: -1 });

        if (subs.length === 0) {
            await ctx.reply("You have no subscriptions.");
            return;
        }

        let msg = "📅 <b>My Subscriptions</b>\n\n";

        for (const sub of subs) {
            const channel = sub.channelId as any;
            if (!channel) continue;

            const statusIcon = sub.status === 'active' ? '✅' : '❌';
            const dateStr = new Date(sub.endDate).toLocaleDateString();

            msg += `<b>${channel.title}</b>\n`;
            msg += `Status: ${sub.status.toUpperCase()} ${statusIcon}\n`;
            msg += `Expires: ${dateStr}\n`;

            if (sub.status !== 'active') { // Show renew link if expired? Or reuse renew_sub_ID logic via button
                // We can add a Renew Button below the text list? 
                // If list is long, buttons are tricky.
                // Just show status. 
            }
            msg += "\n";
        }

        // Maybe add buttons for each expired sub? Too complex for text list.
        // Just text for now.
        await ctx.reply(msg, { parse_mode: 'HTML' });
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

        const { InlineKeyboard } = await import('grammy');
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
        // Maybe add Amount with Comma
        report += `\n📅 ${date} | <b>${(tx.type || 'TX').toUpperCase()}</b>`;
        report += `\n💸 ${tx.amount.toLocaleString()} MMK (${tx.status})`;
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


