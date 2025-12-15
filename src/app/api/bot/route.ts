import { bot } from '@/bot/bot';
import dbConnect from '@/lib/db';
import { webhookCallback } from 'grammy';

// Register handlers (side-effect import)
// We need to make sure handlers are registered before the bot handles the update
import '@/bot/handlers'; // This file will contain the actual logic

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        await dbConnect();

        const body = await req.json();
        console.log('Webhook Body Type:', typeof body);
        if (body && typeof body === 'object') {
            const updateId = body.update_id;
            const keys = Object.keys(body);
            console.log(`Webhook Rx: UpdateID=${updateId} Keys=${keys.join(',')}`);
        } else {
            console.log('Webhook Body Empty/Invalid');
        }

        // Initialize the bot (fetches info from Telegram if not cached)
        await bot.init();
        console.log('Bot Initialized. Processing update...');

        // Explicitly handle update for maximum control in serverless
        await bot.handleUpdate(body);
        console.log('Update Handled.');

        return new Response('OK');
    } catch (e) {
        console.error('Webhook Error:', e);
        return new Response('Error', { status: 500 });
    }
}
