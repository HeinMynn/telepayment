import express from 'express';
import cron from 'node-cron';
import { bot } from './src/bot/bot';
import dbConnect from './src/lib/db';
import { runSubscriptionCron } from './src/cron';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'ok', bot: (bot.botInfo as any)?.username || 'not initialized' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Telegram webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        // Verify webhook secret token
        const secret = req.headers['x-telegram-bot-api-secret-token'];
        if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
            console.log('[Webhook] Unauthorized - invalid secret token');
            return res.sendStatus(403);
        }

        const body = req.body;
        console.log(`[Webhook] UpdateID=${body.update_id} Keys=${Object.keys(body).join(',')}`);

        await bot.handleUpdate(body);
        res.sendStatus(200);
    } catch (err) {
        console.error('[Webhook] Error:', err);
        res.sendStatus(500);
    }
});

// Manual cron trigger (for testing)
app.get('/cron/check-subscriptions', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    await runSubscriptionCron();
    res.json({ success: true });
});

async function start() {
    console.log('[Server] Connecting to MongoDB...');
    await dbConnect();
    console.log('[Server] MongoDB connected.');

    // Initialize bot FIRST (before importing handlers)
    console.log('[Server] Initializing bot...');
    await bot.init();
    console.log(`[Server] Bot ready: @${bot.botInfo.username}`);

    // Import handlers AFTER bot is initialized
    console.log('[Server] Loading handlers...');
    await import('./src/bot/handlers');
    console.log('[Server] Handlers loaded.');

    // Schedule cron job (runs daily at midnight UTC)
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cron] Scheduled job starting...');
        await runSubscriptionCron();
    });
    console.log('[Server] Cron job scheduled: 0 0 * * * (daily at midnight UTC)');

    // Start server
    app.listen(PORT, () => {
        console.log(`[Server] Running on port ${PORT}`);
        console.log(`[Server] Webhook URL: https://your-domain.onrender.com/webhook`);
    });
}

start().catch(err => {
    console.error('[Server] Fatal error:', err);
    process.exit(1);
});
