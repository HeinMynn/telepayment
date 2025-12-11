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

        // Explicitly handle update for maximum control in serverless
        await bot.handleUpdate(body);

        return new Response('OK');
    } catch (e) {
        console.error('Webhook Error:', e);
        return new Response('Error', { status: 500 });
    }
}
