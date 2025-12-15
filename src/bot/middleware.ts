import { NextFunction } from 'grammy';
import { BotContext } from './types';
import User from '@/models/User';
import { t, isValidLanguage } from '@/lib/i18n';

export async function authMiddleware(ctx: BotContext, next: NextFunction) {
    if (!ctx.from) return next();

    const telegramId = ctx.from.id;
    const { username, first_name, last_name } = ctx.from;

    // Find or create user
    // We don't need 'await dbConnect()' here if it's called in the route handler
    // Find or create user
    // We don't need 'await dbConnect()' here if it's called in the route handler
    console.time('UserFetch');
    let user = await User.findOne({ telegramId });
    console.timeEnd('UserFetch');
    console.log('Middleware processing for user:', telegramId, user ? 'Found' : 'New');

    if (!user) {
        // Detect language
        const langCode = ctx.from.language_code || 'en';
        const language = isValidLanguage(langCode) ? langCode : 'en';

        user = await User.create({
            telegramId,
            language,
            role: (process.env.ADMIN_ID && String(telegramId) === process.env.ADMIN_ID) ? 'admin' : 'user',
            username,
            firstName: first_name,
            lastName: last_name
        });
    } else {
        // Update info if changed
        // Also check if they should be admin now
        if (process.env.ADMIN_ID && String(telegramId) === process.env.ADMIN_ID && user.role !== 'admin') {
            user.role = 'admin';
            await user.save();
        } else if (user.username !== username || user.firstName !== first_name || user.lastName !== last_name) {
            user.username = username;
            user.firstName = first_name;
            user.lastName = last_name;
            await user.save();
        }
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

        // Handle Inline Query block
        if (ctx.inlineQuery) {
            console.log('[Middleware] Blocking Inline Query due to ToS');
            await ctx.answerInlineQuery([{
                type: 'article',
                id: 'tos_block',
                title: '⛔ Accept Terms First',
                description: 'Please go to private chat and type /start to accept Terms.',
                input_message_content: { message_text: 'Please accept Terms of Service in private chat.' }
            }], { cache_time: 0, is_personal: true });
            return;
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

    // State Routing
    if (user.interactionState && user.interactionState !== 'idle') {
        // Dynamic import to avoid circular dependency if stateHandler imports types that might import middleware? 
        // Actually imports are fine: stateHandler -> types. middleware -> types.
        const { handleState } = await import('./stateHandler');
        await handleState(ctx);
        return;
    }

    await next();
}
