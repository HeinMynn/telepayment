import { Bot } from 'grammy';
import { BotContext } from './types';
import { rateLimitMiddleware } from './rateLimit';
import { authMiddleware } from './middleware';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

let botConfig: any = {};

// Optimization: Hardcode Bot Info to skip init()
if (process.env.TELEGRAM_BOT_USERNAME) {
    const id = parseInt(token.split(':')[0]);
    if (!isNaN(id)) {
        botConfig.botInfo = {
            id: id,
            is_bot: true,
            first_name: process.env.TELEGRAM_BOT_USERNAME, // Fallback use username as name
            username: process.env.TELEGRAM_BOT_USERNAME,
            can_join_groups: true,
            can_read_all_group_messages: false,
            supports_inline_queries: true
        };
        console.log(`[Bot] Fast Startup: ${process.env.TELEGRAM_BOT_USERNAME} (${id})`);
    }
}

export const bot = new Bot<BotContext>(token, botConfig);

// Attach Middleware
bot.use(rateLimitMiddleware); // Rate limit first
bot.use(authMiddleware);

// Error handling
bot.catch((err) => {
    console.error('Bot Error:', err);
});

// We will attach commands and handlers in a separate init function or import them here
// to ensure side-effects run.
// For now, we'll keep it clean. Handlers will be attached in `route.ts` or here?
// Best practice: Attach handlers here.

// I'll import handlers here when I create them.
// import './handlers'; 
