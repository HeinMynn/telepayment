import { bot } from './bot';
import { t } from '@/lib/i18n';
import User from '@/models/User';
import MerchantProfile from '@/models/MerchantProfile';
import Transaction from '@/models/Transaction';
import { InlineKeyboard } from 'grammy';
import { handlePaymentStart, initPaymentHandlers } from './payment';

// Initialize payment listeners
initPaymentHandlers();

// Onboarding / Start
bot.command('start', async (ctx) => {
    const payload = ctx.match; // Deep link payload
    if (payload && payload.startsWith('pay_')) {
        return handlePaymentStart(ctx, payload);
    }

    const user = ctx.user;
    if (!user.termsAccepted) {
        const keyboard = new InlineKeyboard().text(t(user.language as any, 'tos_agree'), 'accept_tos');
        await ctx.reply(t(user.language as any, 'welcome') + "\n\n" + t(user.language as any, 'tos_text'), { reply_markup: keyboard });
    } else {
        await ctx.reply(t(user.language as any, 'welcome'));
    }
});

// Terms Acceptance
bot.callbackQuery('accept_tos', async (ctx) => {
    const user = ctx.user;
    if (user.termsAccepted) return ctx.answerCallbackQuery();

    user.termsAccepted = true;
    user.termsAcceptedAt = new Date();
    await user.save();

    await ctx.answerCallbackQuery({ text: "Terms Accepted!" }); // Localize?
    // "Terms Accepted!" is generic confirmation.
    await ctx.editMessageText(t(user.language as any, 'welcome')); // Remove button
});

// Merchant Registration
bot.command('become_merchant', async (ctx) => {
    const user = ctx.user;
    if (user.role === 'merchant') {
        return ctx.reply(t(user.language as any, 'merchant_success'));
    }

    const keyboard = new InlineKeyboard().text(t(user.language as any, 'merchant_agree'), 'accept_merchant_rules');
    await ctx.reply(t(user.language as any, 'merchant_rules'), { reply_markup: keyboard });
});

bot.callbackQuery('accept_merchant_rules', async (ctx) => {
    const user = ctx.user;

    // Check if already profile exists (idempotency)
    const existing = await MerchantProfile.findOne({ userId: user._id });
    if (!existing) {
        await MerchantProfile.create({
            userId: user._id,
            businessName: "Pending Setup",
            withdrawalMethod: "Not Set",
            agreedToMerchantRules: true
        });
    }

    user.role = 'merchant';
    await user.save();

    await ctx.answerCallbackQuery({ text: "Welcome Merchant!" });
    await ctx.editMessageText(t(user.language as any, 'merchant_success'));
});

// Admin Tools
bot.command('freeze', async (ctx) => {
    if (ctx.user.role !== 'admin') return;

    const targetIdStr = ctx.match;
    const targetId = parseInt(targetIdStr);
    if (isNaN(targetId)) return ctx.reply("Usage: /freeze [telegramId]");

    const target = await User.findOne({ telegramId: targetId });
    if (target) {
        target.isFrozen = true;
        await target.save();
        ctx.reply(`User ${targetId} frozen.`);
    } else {
        ctx.reply("User not found.");
    }
});

bot.command('audit', async (ctx) => {
    if (ctx.user.role !== 'admin') return;

    const targetIdStr = ctx.match;
    const targetId = parseInt(targetIdStr);
    if (isNaN(targetId)) return ctx.reply("Usage: /audit [telegramId]");

    const target = await User.findOne({ telegramId: targetId });
    if (!target) return ctx.reply("User not found.");

    const txs = await Transaction.find({
        $or: [{ fromUser: target._id }, { toUser: target._id }]
    }).sort({ createdAt: -1 }).limit(5);

    if (txs.length === 0) return ctx.reply("No transactions found.");

    let report = `Audit Report for ${targetId}:\n`;
    txs.forEach(tx => {
        report += `\nID: ${tx._id}\nType: ${String(tx.fromUser) === String(target._id) ? 'SENT' : 'RECEIVED'}\nAmount: ${tx.amount}\nStatus: ${tx.status}\nDate: ${tx.createdAt}`;
    });

    ctx.reply(report);
});
