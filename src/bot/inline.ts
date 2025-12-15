import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';

export async function handleInlineQuery(ctx: BotContext) {
    console.log(`[Inline] Query: "${ctx.inlineQuery?.query}" User: ${ctx.user?.telegramId} Role: ${ctx.user?.role}`);

    try {
        const query = ctx.inlineQuery?.query || '';
        const user = ctx.user;

        // 1. If explicit ID (Share Button)
        if (query.startsWith('invoice_')) {
            console.log(`[Inline] Explicit ID Search: ${query}`);
            const uniqueId = query.replace('invoice_', '');
            const { default: Invoice } = await import('@/models/Invoice');
            const invoice = await Invoice.findOne({ uniqueId });

            if (!invoice || invoice.status !== 'active') {
                // Try to find even if completed (reusable)
                if (!invoice || (invoice.status !== 'completed' && invoice.type !== 'reusable')) {
                    console.log('[Inline] Invoice not found/active');
                    return ctx.answerInlineQuery([], { cache_time: 5 });
                }
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
            return;
        }

        // 2. If Merchant listing their own invoices (Empty or Search)
        if (user.role === 'merchant') {
            console.log('[Inline] Merchant List Mode');
            const { default: Invoice } = await import('@/models/Invoice');

            // Filter
            const filter: any = {
                merchantId: user._id,
                status: { $ne: 'revoked' } // Show active and completed?
            };

            const invoices = await Invoice.find(filter).sort({ createdAt: -1 }).limit(20);
            console.log(`[Inline] Found ${invoices.length} invoices`);
            const botUsername = ctx.me?.username || 'bot';

            const results = invoices.map(inv => {
                const link = `https://t.me/${botUsername}?start=pay_${inv.uniqueId}`;
                const amountDisplay = inv.amount.toLocaleString();
                // Ensure uniqueId is valid string
                const resultId = inv.uniqueId || inv._id.toString();

                return {
                    type: 'article',
                    id: resultId,
                    title: `${amountDisplay} MMK`,
                    description: `${inv.type.toUpperCase()} - Used: ${inv.usageCount}`,
                    input_message_content: {
                        message_text: `🧾 <b>Invoice</b>\n\nAmount: ${amountDisplay} MMK\nType: ${inv.type}\n\nClick below to pay.`,
                        parse_mode: 'HTML'
                    },
                    reply_markup: new InlineKeyboard().url(`💸 Pay ${amountDisplay} MMK`, link)
                };
            });

            await ctx.answerInlineQuery(results as any, { cache_time: 5, is_personal: true });
        } else {
            // Not merchant
            await ctx.answerInlineQuery([], { cache_time: 60 });
        }
    } catch (e) {
        console.error('[Inline] Error:', e);
        // Try to answer empty to stop spinner
        await ctx.answerInlineQuery([]).catch(() => { });
    }
}
