import { NextFunction } from 'grammy';
import { BotContext } from './types';

// In-memory rate limit store
// Format: { [telegramId]: { count: number, resetTime: number } }
const rateLimitStore = new Map<number, { count: number; resetTime: number }>();

// Configuration
const RATE_LIMIT = 30; // Max requests
const WINDOW_MS = 60 * 1000; // Per minute

// Cleanup old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    rateLimitStore.forEach((value, key) => {
        if (now > value.resetTime) {
            rateLimitStore.delete(key);
        }
    });
}, 5 * 60 * 1000);

export async function rateLimitMiddleware(ctx: BotContext, next: NextFunction) {
    if (!ctx.from) return next();

    const userId = ctx.from.id;
    const now = Date.now();

    let userData = rateLimitStore.get(userId);

    if (!userData || now > userData.resetTime) {
        // Reset window
        userData = { count: 1, resetTime: now + WINDOW_MS };
        rateLimitStore.set(userId, userData);
    } else {
        userData.count++;

        if (userData.count > RATE_LIMIT) {
            // Rate limited
            const waitSec = Math.ceil((userData.resetTime - now) / 1000);
            console.log(`[RateLimit] User ${userId} exceeded limit (${userData.count}/${RATE_LIMIT})`);

            // Only respond once per window to avoid spam
            if (userData.count === RATE_LIMIT + 1) {
                await ctx.reply(`⚠️ Slow down! Too many requests. Please wait ${waitSec} seconds.`);
            }
            return; // Block request
        }
    }

    await next();
}
