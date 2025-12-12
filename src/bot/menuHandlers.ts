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

    // 3. Main Menu -> History
    if (text === t(l, 'menu_history')) {
        const { default: Transaction } = await import('@/models/Transaction');
        // Last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const txs = await Transaction.find({
            $or: [{ fromUser: user._id }, { toUser: user._id }],
            createdAt: { $gte: sevenDaysAgo }
        }).sort({ createdAt: -1 }).limit(10);

        if (txs.length === 0) {
            await ctx.reply("No transactions in last 7 days.");
            return;
        }

        let report = "📜 <b>History (Last 7 Days)</b>\n";
        txs.forEach(tx => {
            const date = new Date(tx.createdAt).toLocaleDateString();
            const typeHeader = tx.type.toUpperCase();
            report += `\n${date} - ${typeHeader}: ${tx.amount} (${tx.status})`;
        });
        await ctx.reply(report, { parse_mode: 'HTML' });
        return;
    }

    // 4. Main Menu -> Settings
    if (text === t(l, 'menu_settings')) {
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

        const kb = new InlineKeyboard().text(t(l, 'settings_add_account'), 'add_payment_account');
        await ctx.reply(msg, { reply_markup: kb, parse_mode: 'HTML' });
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

    await ctx.reply(t(l, 'topup_intro'));
    await ctx.reply(t(l, 'enter_topup_amount'), { reply_markup: getCancelKeyboard(user.language) });
    // Set State
    user.interactionState = 'awaiting_topup_amount';
    await user.save();
}
