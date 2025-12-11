import { NextFunction } from 'grammy';
import { BotContext } from './types';
import User from '@/models/User';
import { t, isValidLanguage } from '@/lib/i18n';

export async function authMiddleware(ctx: BotContext, next: NextFunction) {
    if (!ctx.from) return next();

    const telegramId = ctx.from.id;

    // Find or create user
    // We don't need 'await dbConnect()' here if it's called in the route handler
    let user = await User.findOne({ telegramId });

    if (!user) {
        // Detect language
        const langCode = ctx.from.language_code || 'en';
        const language = isValidLanguage(langCode) ? langCode : 'en';

        user = await User.create({
            telegramId,
            language,
            role: 'user',
        });
    }

    // Attach to context
    ctx.user = user;

    // Check frozen
    if (user.isFrozen) {
        const msg = t(user.language as any, 'account_frozen');
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: msg, show_alert: true });
        } else {
            // Only reply if it's not a generic update that might cause spam
            if (ctx.message || ctx.callbackQuery) {
                // Silence is sometimes better for banned users, but user asked for "/freeze" so maybe explicit feedback?
                // "Ban Check... ignore all input" - User said IGNORE.
                // But maybe for /start?
                // "If User.isFrozen is true, ignore all input."
                // Okay, I will return and NOT call next(). 
                return;
            }
        }
        return;
    }

    /* 
       Global ToS Check:
       Exceptions: 
       1. /start command (to show welcome/ToS button).
       2. callback queries related to ToS acceptance.
    */

    if (!user.termsAccepted) {
        const text = ctx.message?.text;

        // Allow /start to flow through to the handler (which will show ToS)
        if (text && text.startsWith('/start')) {
            return next();
        }

        // Allow clicking the "I Agree" button
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'accept_tos') {
            return next();
        }

        // Otherwise block and warn
        const msg = t(user.language as any, 'tos_rejected');
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: msg, show_alert: true });
        } else if (ctx.message) {
            await ctx.reply(msg);
        }
        return;
    }

    await next();
}
