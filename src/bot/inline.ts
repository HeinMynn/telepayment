import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';

export async function handleInlineQuery(ctx: BotContext) {
    const query = ctx.inlineQuery?.query || '';

    if (query.startsWith('invoice_')) {
        const uniqueId = query.replace('invoice_', '');
        const { default: Invoice } = await import('@/models/Invoice');
        const invoice = await Invoice.findOne({ uniqueId });

        if (!invoice || invoice.status !== 'active') {
            // Return empty or error article?
            return ctx.answerInlineQuery([], { cache_time: 5 });
        }

        const botUsername = ctx.me?.username || 'bot';
        const link = `https://t.me/${botUsername}?start=pay_${uniqueId}`;
        const amountDisplay = invoice.amount.toLocaleString();

        await ctx.answerInlineQuery([{
            type: 'article',
            id: uniqueId,
            title: `Invoice: ${amountDisplay} MMK`,
            description: `Payment Invoice (${invoice.type}). Click to send.`,
            input_message_content: {
                message_text: `🧾 <b>Invoice</b>\n\nAmount: ${amountDisplay} MMK\nStatus: Active\n\nClick below to pay safely.`,
                parse_mode: 'HTML'
            },
            reply_markup: new InlineKeyboard().url(`💸 Pay ${amountDisplay} MMK`, link)
        }], { cache_time: 10, is_personal: false });
    }
}
