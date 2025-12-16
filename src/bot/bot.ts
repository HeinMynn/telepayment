import { Bot } from 'grammy';
import { BotContext } from './types';
import { rateLimitMiddleware } from './rateLimit';
import { authMiddleware } from './middleware';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

export const bot = new Bot<BotContext>(token);

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
