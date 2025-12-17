import express from 'express';
import cron from 'node-cron';
import { bot } from './src/bot/bot';
import dbConnect from './src/lib/db';
import { runSubscriptionCron } from './src/cron';

// Import handlers (side-effect: registers all bot handlers)
import './src/bot/handlers';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'ok', bot: bot.botInfo?.username || 'not initialized' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Telegram webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
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

    // Initialize bot
    if (!bot.botInfo) {
        await bot.init();
    }
    console.log(`[Server] Bot ready: @${(bot.botInfo as any)?.username || 'unknown'}`);

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
