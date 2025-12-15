import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import { getPaginationKeyboard, getInvoiceMenu } from './menus';

export async function showInvoices(ctx: BotContext, page: number, type: string) {
    const { default: Invoice } = await import('@/models/Invoice');
    const user = ctx.user;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    const filter = {
        merchantId: user._id,
        type: type,
        status: { $ne: 'revoked' }
    };

    const totalCount = await Invoice.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalCount === 0) {
        if (page === 1) {
            await ctx.deleteMessage();
            await ctx.reply(`No active ${type} invoices found.`, { reply_markup: getInvoiceMenu(user.language) });
        } else {
            await ctx.answerCallbackQuery("No more invoices.");
        }
        return;
    }

    const invoices = await Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize);

    const kb = new InlineKeyboard();
    invoices.forEach((inv) => {
        const amount = inv.amount.toLocaleString();
        // Label format: "10,000 MMK (5 Paid)"
        kb.text(`${amount} MMK (${inv.usageCount} Paid)`, `view_invoice_${inv._id}`).row();
    });

    // Pagination Rows
    // We need to pass type to pagination prefix?
    // getPaginationKeyboard generates `prefix_page_X`.
    // If prefix is `invoices`, we get `invoices_page_X`.
    // But we need to know TYPE.
    // So callback should be `invoices_page_X_TYPE`.
    // My helper only supports `prefix_page_X`.
    // I need to customize helper OR use custom loop here.

    // Custom Pagination Row
    if (totalPages > 1) {
        const row = [];
        if (page > 1) row.push({ text: "⬅️ Prev", callback_data: `invoices_page_${page - 1}_${type}` });
        row.push({ text: `${page} / ${totalPages}`, callback_data: "noop" });
        if (page < totalPages) row.push({ text: "Next ➡️", callback_data: `invoices_page_${page + 1}_${type}` });

        // Add row to kb
        kb.row(...row);
    }

    kb.row().text("🔙 Back", "merchant_menu_invoice");

    try {
        await ctx.editMessageText(`🧾 <b>Select ${type} Invoice</b>\nPage ${page}/${totalPages}`, {
            reply_markup: kb,
            parse_mode: 'HTML'
        });
    } catch (e: any) {
        if (!e.description?.includes('message is not modified')) {
            // Maybe message invalid?
            // E.g. trying to edit deleted message.
            // Fallback to reply?
            // await ctx.reply(...)
        }
    }
}
