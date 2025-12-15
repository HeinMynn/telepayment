import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import User from '@/models/User';
import Transaction from '@/models/Transaction';
import Subscription from '@/models/Subscription';

export async function handleAdminCommand(ctx: BotContext) {
    const adminId = process.env.ADMIN_ID;
    const user = ctx.user;

    // Soft check: Env ID or DB Role
    const isAdmin = (adminId && user.telegramId.toString() === adminId) || user.role === 'admin';

    if (!isAdmin) {
        return ctx.reply("⛔ Access Denied.");
    }

    const kb = new InlineKeyboard()
        .text("📊 Statistics", "admin_stats").row()
        .text("📢 Broadcast", "admin_broadcast").row()
        .text("👥 Manage Users", "admin_users").row()
        .text("🔍 Find User", "admin_find_user");

    await ctx.reply("🛡️ <b>Admin Dashboard</b>\nSelect an action:", { reply_markup: kb, parse_mode: 'HTML' });
}

export async function handleAdminStats(ctx: BotContext) {
    await ctx.answerCallbackQuery("Loading stats...");

    // 1. Users
    const totalUsers = await User.countDocuments({});

    // 2. Active Subs
    const activeSubs = await Subscription.countDocuments({ status: 'active' });

    // 3. Financials (Income from Payments + Subscriptions)
    // We only count 'completed' transactions of type 'payment' or 'subscription'.
    // 'topup' is user money (liability). 'withdrawal' is outflow.
    const incomeStats = await Transaction.aggregate([
        { $match: { type: { $in: ['payment', 'subscription'] }, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalIncome = incomeStats[0]?.total || 0;

    // 4. Pending Withdrawals
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' }); // 'withdraw' fixed previously

    const msg = `📊 <b>System Statistics</b>\n\n` +
        `👥 Users: <b>${totalUsers}</b>\n` +
        `✅ Active Subscriptions: <b>${activeSubs}</b>\n` +
        `💰 Total Revenue: <b>${totalIncome.toLocaleString()} MMK</b>\n` +
        `⏳ Pending Withdrawals: <b>${pendingWithdrawals}</b>`;

    const kb = new InlineKeyboard()
        .text("🔄 Refresh", "admin_stats").row()
        .text("🔙 Back", "admin_home");
    // We need 'admin_home' handler or just re-call /admin logic.

    // If callback, edit
    if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: 'HTML' });
    } else {
        await ctx.reply(msg, { reply_markup: kb, parse_mode: 'HTML' });
    }
}

export async function handleAdminBroadcast(ctx: BotContext) {
    ctx.user.interactionState = 'awaiting_broadcast_message';
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply("📢 <b>Broadcast Mode</b>\n\nSend the message you want to broadcast to ALL users.\nType /cancel to abort.", { parse_mode: 'HTML' });
}

export async function processBroadcast(ctx: BotContext, message: string) {
    if (!message) return;

    // Find all users
    const users = await User.find({}, { telegramId: 1 });
    let success = 0;
    let fail = 0;

    await ctx.reply(`🚀 Starting broadcast to ${users.length} users...`);

    // Iterate
    // Note: iterating large list in memory is risky for huge scale, 
    // but for MVP < 10k users, it's manageable with delay.
    // Use for...of to allow await.

    for (const u of users) {
        try {
            await ctx.api.sendMessage(u.telegramId, `📢 <b>Announcement</b>\n\n${message}`, { parse_mode: 'HTML' });
            success++;
        } catch (e) {
            fail++;
            // Blocked user?
        }
        // Small delay to prevent rate limit (30 msgs/sec limit globally)
        // 50ms delay = 20msgs/sec
        await new Promise(r => setTimeout(r, 50));
    }

    ctx.user.interactionState = 'idle';
    await ctx.user.save();

    await ctx.reply(`✅ Broadcast Completed.\n\nSent: ${success}\nFailed: ${fail}`);
}

export async function handleAdminUsers(ctx: BotContext) {
    // Find frozen users
    const frozenUsers = await User.find({ isFrozen: true });

    if (frozenUsers.length === 0) {
        const kb = new InlineKeyboard().text("🔙 Back", "admin_home");
        await ctx.editMessageText("👥 <b>User Management</b>\n\nNo accounts are currently frozen.", { reply_markup: kb, parse_mode: 'HTML' });
        return;
    }

    const kb = new InlineKeyboard();
    frozenUsers.forEach(u => {
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || `ID: ${u.telegramId}`;
        kb.text(`🔓 Unfreeze ${name}`, `admin_unfreeze_${u._id}`).row();
    });
    kb.text("🔙 Back", "admin_home");

    await ctx.editMessageText("👥 <b>Frozen Accounts</b>\n\nSelect a user to unfreeze:", { reply_markup: kb, parse_mode: 'HTML' });
}

export async function handleUnfreezeUser(ctx: BotContext, userId: string) {
    const user = await User.findById(userId);
    if (!user) return ctx.answerCallbackQuery("User not found.");

    user.isFrozen = false;
    await user.save();

    await ctx.answerCallbackQuery("User Unfrozen.");
    // Refresh list? Or just edit text?
    // Let's refresh the list.
    await handleAdminUsers(ctx);

    // Notify User
    try {
        await ctx.api.sendMessage(user.telegramId, "✅ <b>Account Unfrozen</b>\n\nYour account has been reactivated by an administrator.", { parse_mode: 'HTML' });
    } catch (e) { }
}

export async function handleFindUserPrompt(ctx: BotContext) {
    ctx.user.interactionState = 'awaiting_admin_user_search';
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply("🔍 <b>Find User</b>\n\nPlease enter the User's Telegram ID (e.g. 12345678):", { parse_mode: 'HTML' });
}

export async function processUserSearch(ctx: BotContext, query: string) {
    // Try Telegram ID
    let target = await User.findOne({ telegramId: query });

    // If not found, try _id (if valid ObjectId)
    if (!target && query.match(/^[0-9a-fA-F]{24}$/)) {
        target = await User.findById(query);
    }

    if (!target) {
        await ctx.reply("❌ User not found.");
        ctx.user.interactionState = 'idle';
        await ctx.user.save();
        return;
    }

    // Show User Profile
    const { InlineKeyboard } = await import('grammy');
    const status = target.isFrozen ? "🔴 FROZEN" : "🟢 Active";
    const role = target.role.toUpperCase();
    const balance = target.balance.toLocaleString();
    const joined = new Date(target.createdAt).toLocaleDateString();

    const msg = `👤 <b>User Profile</b>\n\n` +
        `ID: <code>${target.telegramId}</code>\n` +
        `Name: ${target.firstName} ${target.lastName || ''}\n` +
        `Role: ${role}\n` +
        `Balance: ${balance} MMK\n` +
        `Status: ${status}\n` +
        `Joined: ${joined}`;

    const kb = new InlineKeyboard();
    if (target.isFrozen) {
        kb.text("🔓 Unfreeze", `admin_unfreeze_${target._id}`);
    } else {
        kb.text("❄️ Freeze", `admin_freeze_${target._id}`);
    }
    // Maybe Add/Remove Balance? (Future)
    kb.row().text("🔙 Admin Menu", "admin_home");

    await ctx.reply(msg, { reply_markup: kb, parse_mode: 'HTML' });

    ctx.user.interactionState = 'idle';
    await ctx.user.save();
}

export async function handleFreezeUser(ctx: BotContext, userId: string) {
    const user = await User.findById(userId);
    if (!user) return ctx.answerCallbackQuery("User not found.");

    user.isFrozen = true;
    await user.save();

    await ctx.answerCallbackQuery("User Frozen.");

    // Refresh View? We can't easily refresh the "User Profile" message without tracking it.
    // Just reply "Frozen". The user can search again to verify.
    // Or try to edit message if callback message exists.
    // Re-construct profile msg?
    // Let's just edit caption/text to say "FROZEN".

    try {
        await ctx.editMessageText(ctx.callbackQuery?.message?.text + "\n\n🔴 <b>USER FROZEN</b>", { parse_mode: 'HTML', reply_markup: undefined });
    } catch (e) { }

    // Notify User
    try {
        await ctx.api.sendMessage(user.telegramId, "⛔ <b>Account Frozen</b>\n\nYour account has been frozen by an administrator. Please contact support.", { parse_mode: 'HTML' });
    } catch (e) { }
}
