import { BotContext } from './types';
import { InlineKeyboard } from 'grammy';
import User from '@/models/User';
import Transaction from '@/models/Transaction';
import Subscription from '@/models/Subscription';
import MerchantChannel from '@/models/MerchantChannel';
import Settings, { DEFAULT_POPULAR_PRICING } from '@/models/Settings';

export async function handleAdminCommand(ctx: BotContext) {
    const adminId = process.env.ADMIN_ID;
    const user = ctx.user;

    // Soft check: Env ID or DB Role
    const isAdmin = (adminId && user.telegramId.toString() === adminId) || user.role === 'admin';

    if (!isAdmin) {
        return ctx.reply("⛔ Access Denied.");
    }

    // Get pending counts
    const pendingTopups = await Transaction.countDocuments({ type: 'topup', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
    const popularCount = await MerchantChannel.countDocuments({ isPopular: true });

    const kb = new InlineKeyboard()
        .text("📊 Statistics", "admin_stats").row()
        .text(`💰 Pending Topups (${pendingTopups})`, "admin_topups").row()
        .text(`📤 Pending Withdrawals (${pendingWithdrawals})`, "admin_withdrawals").row()
        .text(`🔥 Popular Channels (${popularCount})`, "admin_popular").text("💎 Pricing", "admin_pricing").row()
        .text("📢 Broadcast", "admin_broadcast").row()
        .text("👥 Frozen Accounts", "admin_users").text("🔍 Find User", "admin_find_user");

    await ctx.reply("🛡️ <b>Admin Dashboard</b>\n\nSelect an action:", { reply_markup: kb, parse_mode: 'HTML' });
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

export async function handleFeatureChannel(ctx: BotContext, channelIdArg: string) {
    const adminId = process.env.ADMIN_ID;
    const isAdmin = (adminId && ctx.user.telegramId.toString() === adminId) || ctx.user.role === 'admin';

    if (!isAdmin) {
        return ctx.reply("⛔ Access Denied.");
    }

    if (!channelIdArg) {
        return ctx.reply("Usage: /feature <channelId>\n\nExample: /feature 507f1f77bcf86cd799439011");
    }

    // Find channel by _id
    const channel = await MerchantChannel.findById(channelIdArg);
    if (!channel) {
        return ctx.reply("❌ Channel not found. Make sure to use the MongoDB ObjectId.");
    }

    // Toggle featured status
    channel.isFeatured = !channel.isFeatured;
    await channel.save();

    const status = channel.isFeatured ? "⭐ FEATURED" : "📢 Regular";
    await ctx.reply(`✅ Channel <b>${channel.title}</b> is now: ${status}`, { parse_mode: 'HTML' });
}

// Pending Topups
export async function handleAdminTopups(ctx: BotContext) {
    await ctx.answerCallbackQuery();

    const topups = await Transaction.find({ type: 'topup', status: 'pending' })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('fromUser', 'firstName telegramId');

    if (topups.length === 0) {
        const kb = new InlineKeyboard().text("🔙 Back", "admin_home");
        return ctx.editMessageText("💰 <b>Pending Topups</b>\n\nNo pending topups.", { reply_markup: kb, parse_mode: 'HTML' });
    }

    const kb = new InlineKeyboard();
    for (const tx of topups) {
        const user = tx.fromUser as any;
        const name = user?.firstName || `ID: ${user?.telegramId}`;
        kb.text(`👁️ ${name} - ${tx.amount.toLocaleString()} MMK`, `view_topup_${tx._id}`).row();
    }
    kb.text("🔙 Back", "admin_home");

    try {
        await ctx.editMessageText("💰 <b>Pending Topups</b>\n\nTap to view receipt:", { reply_markup: kb, parse_mode: 'HTML' });
    } catch (e: any) {
        // If edit fails (e.g., photo message), send new message
        if (e?.message?.includes('no text') || e?.message?.includes('not modified')) {
            await ctx.reply("💰 <b>Pending Topups</b>\n\nTap to view receipt:", { reply_markup: kb, parse_mode: 'HTML' });
        } else {
            throw e;
        }
    }
}

// View Topup Receipt
export async function handleViewTopup(ctx: BotContext, txId: string) {
    await ctx.answerCallbackQuery();

    const tx = await Transaction.findById(txId).populate('fromUser', 'firstName lastName telegramId');
    if (!tx) return ctx.reply("Transaction not found.");

    const user = tx.fromUser as any;
    const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || `ID: ${user?.telegramId}`;

    let msg = `💰 <b>Topup Request</b>\n\n`;
    msg += `👤 User: ${name}\n`;
    msg += `🆔 Telegram ID: <code>${user?.telegramId}</code>\n`;
    msg += `💵 Amount: <b>${tx.amount.toLocaleString()} MMK</b>\n`;
    msg += `📅 Date: ${new Date(tx.createdAt).toLocaleString()}\n`;

    const kb = new InlineKeyboard()
        .text("✅ Approve", `approve_topup_${txId}`)
        .text("❌ Reject", `reject_topup_${txId}`).row()
        .text("🔙 Back", "admin_topups");

    // If there's a proof image, send it with the caption
    if (tx.proofImageId) {
        await ctx.replyWithPhoto(tx.proofImageId, { caption: msg, parse_mode: 'HTML', reply_markup: kb });
    } else {
        await ctx.reply(msg + "\n⚠️ No receipt image provided.", { parse_mode: 'HTML', reply_markup: kb });
    }
}

// Approve Topup
export async function handleApproveTopup(ctx: BotContext, txId: string) {
    await ctx.answerCallbackQuery("Processing...");

    const tx = await Transaction.findById(txId).populate('fromUser');
    if (!tx) return ctx.reply("Transaction not found.");

    if (tx.status !== 'pending') {
        return ctx.reply("This topup has already been processed.");
    }

    const targetUser = tx.fromUser as any;
    if (!targetUser) return ctx.reply("User not found.");

    // Update user balance
    targetUser.balance += tx.amount;
    await targetUser.save();

    // Update transaction status
    tx.status = 'completed';
    tx.adminProcessedBy = ctx.user._id;
    await tx.save();

    // Notify admin
    await ctx.reply(`✅ Topup approved!\n\n💵 Amount: ${tx.amount.toLocaleString()} MMK\n👤 User: ${targetUser.firstName || targetUser.telegramId}`);

    // Notify user
    try {
        await ctx.api.sendMessage(targetUser.telegramId,
            `✅ <b>Topup Approved!</b>\n\n💵 Amount: <b>${tx.amount.toLocaleString()} MMK</b>\n💰 New Balance: <b>${targetUser.balance.toLocaleString()} MMK</b>`,
            { parse_mode: 'HTML' }
        );
    } catch (e) { }
}

// Reject Topup - Start reason input
export async function handleRejectTopupStart(ctx: BotContext, txId: string) {
    ctx.user.interactionState = 'awaiting_topup_reject_reason';
    ctx.user.tempData = { rejectTxId: txId };
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply("Please enter the reason for rejection:");
}

// Process Topup Rejection (called from stateHandler)
export async function processTopupRejection(ctx: BotContext, reason: string) {
    const txId = ctx.user.tempData?.rejectTxId;
    if (!txId) {
        await ctx.reply("Session expired.");
        ctx.user.interactionState = 'idle';
        await ctx.user.save();
        return;
    }

    const tx = await Transaction.findById(txId).populate('fromUser');
    if (!tx) {
        await ctx.reply("Transaction not found.");
        ctx.user.interactionState = 'idle';
        ctx.user.tempData = undefined;
        await ctx.user.save();
        return;
    }

    if (tx.status !== 'pending') {
        await ctx.reply("This topup has already been processed.");
        ctx.user.interactionState = 'idle';
        ctx.user.tempData = undefined;
        await ctx.user.save();
        return;
    }

    // Update transaction
    tx.status = 'rejected';
    tx.rejectionReason = reason;
    tx.adminProcessedBy = ctx.user._id;
    await tx.save();

    ctx.user.interactionState = 'idle';
    ctx.user.tempData = undefined;
    await ctx.user.save();

    await ctx.reply(`❌ Topup rejected.`);

    // Notify user
    const targetUser = tx.fromUser as any;
    if (targetUser) {
        try {
            await ctx.api.sendMessage(targetUser.telegramId,
                `❌ <b>Topup Rejected</b>\n\n💵 Amount: <b>${tx.amount.toLocaleString()} MMK</b>\n📝 Reason: ${reason}`,
                { parse_mode: 'HTML' }
            );
        } catch (e) { }
    }
}

// Pending Withdrawals
export async function handleAdminWithdrawals(ctx: BotContext) {
    await ctx.answerCallbackQuery();

    const withdrawals = await Transaction.find({ type: 'withdraw', status: 'pending' })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('fromUser', 'firstName telegramId paymentMethods');

    if (withdrawals.length === 0) {
        const kb = new InlineKeyboard().text("🔙 Back", "admin_home");
        try {
            return ctx.editMessageText("📤 <b>Pending Withdrawals</b>\n\nNo pending withdrawals.", { reply_markup: kb, parse_mode: 'HTML' });
        } catch (e: any) {
            if (e?.message?.includes('no text')) {
                return ctx.reply("📤 <b>Pending Withdrawals</b>\n\nNo pending withdrawals.", { reply_markup: kb, parse_mode: 'HTML' });
            }
            throw e;
        }
    }

    const kb = new InlineKeyboard();
    for (const tx of withdrawals) {
        const user = tx.fromUser as any;
        const name = user?.firstName || `ID: ${user?.telegramId}`;
        kb.text(`👁️ ${name} - ${tx.amount.toLocaleString()} MMK`, `view_withdraw_${tx._id}`).row();
    }
    kb.text("🔙 Back", "admin_home");

    try {
        await ctx.editMessageText("📤 <b>Pending Withdrawals</b>\n\nTap to view details:", { reply_markup: kb, parse_mode: 'HTML' });
    } catch (e: any) {
        if (e?.message?.includes('no text') || e?.message?.includes('not modified')) {
            await ctx.reply("📤 <b>Pending Withdrawals</b>\n\nTap to view details:", { reply_markup: kb, parse_mode: 'HTML' });
        } else {
            throw e;
        }
    }
}

// View Withdrawal Details
export async function handleViewWithdrawal(ctx: BotContext, txId: string) {
    await ctx.answerCallbackQuery();

    const tx = await Transaction.findById(txId).populate('fromUser', 'firstName lastName telegramId paymentMethods');
    if (!tx) return ctx.reply("Transaction not found.");

    const user = tx.fromUser as any;
    const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || `ID: ${user?.telegramId}`;

    // Get user's payment method
    const paymentMethods = user?.paymentMethods || [];
    let paymentInfo = "No payment method on file";
    if (paymentMethods.length > 0) {
        const pm = paymentMethods[0];
        paymentInfo = `${pm.provider?.toUpperCase() || 'Unknown'}: ${pm.accountName || ''} - ${pm.accountNumber || ''}`;
    }

    let msg = `📤 <b>Withdrawal Request</b>\n\n`;
    msg += `👤 User: ${name}\n`;
    msg += `🆔 Telegram ID: <code>${user?.telegramId}</code>\n`;
    msg += `💵 Amount: <b>${tx.amount.toLocaleString()} MMK</b>\n`;
    msg += `📅 Date: ${new Date(tx.createdAt).toLocaleString()}\n\n`;
    msg += `💳 <b>Payment Info:</b>\n${paymentInfo}`;

    const kb = new InlineKeyboard()
        .text("✅ Complete", `complete_withdraw_${txId}`)
        .text("❌ Reject", `reject_withdraw_${txId}`).row()
        .text("🔙 Back", "admin_withdrawals");

    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
}

// Complete Withdrawal
export async function handleCompleteWithdrawal(ctx: BotContext, txId: string) {
    await ctx.answerCallbackQuery("Processing...");

    const tx = await Transaction.findById(txId).populate('fromUser');
    if (!tx) return ctx.reply("Transaction not found.");

    if (tx.status !== 'pending') {
        return ctx.reply("This withdrawal has already been processed.");
    }

    const targetUser = tx.fromUser as any;
    if (!targetUser) return ctx.reply("User not found.");

    // Note: Balance was already deducted when withdrawal was requested
    // Just mark as completed
    tx.status = 'completed';
    tx.adminProcessedBy = ctx.user._id;
    await tx.save();

    await ctx.reply(`✅ Withdrawal completed!\n\n💵 Amount: ${tx.amount.toLocaleString()} MMK\n👤 User: ${targetUser.firstName || targetUser.telegramId}`);

    // Notify user
    try {
        await ctx.api.sendMessage(targetUser.telegramId,
            `✅ <b>Withdrawal Completed!</b>\n\n💵 Amount: <b>${tx.amount.toLocaleString()} MMK</b>\n\nYour funds have been sent to your registered payment method.`,
            { parse_mode: 'HTML' }
        );
    } catch (e) { }
}

// Reject Withdrawal - Start reason input
export async function handleRejectWithdrawalStart(ctx: BotContext, txId: string) {
    ctx.user.interactionState = 'awaiting_withdraw_reject_reason';
    ctx.user.tempData = { rejectTxId: txId };
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply("Please enter the reason for rejection:");
}

// Process Withdrawal Rejection (called from stateHandler)
export async function processWithdrawalRejection(ctx: BotContext, reason: string) {
    const txId = ctx.user.tempData?.rejectTxId;
    if (!txId) {
        await ctx.reply("Session expired.");
        ctx.user.interactionState = 'idle';
        await ctx.user.save();
        return;
    }

    const tx = await Transaction.findById(txId).populate('fromUser');
    if (!tx) {
        await ctx.reply("Transaction not found.");
        ctx.user.interactionState = 'idle';
        ctx.user.tempData = undefined;
        await ctx.user.save();
        return;
    }

    if (tx.status !== 'pending') {
        await ctx.reply("This withdrawal has already been processed.");
        ctx.user.interactionState = 'idle';
        ctx.user.tempData = undefined;
        await ctx.user.save();
        return;
    }

    const targetUser = tx.fromUser as any;

    // Refund balance since withdrawal is rejected
    if (targetUser) {
        targetUser.balance += tx.amount;
        await targetUser.save();
    }

    // Update transaction
    tx.status = 'rejected';
    tx.rejectionReason = reason;
    tx.adminProcessedBy = ctx.user._id;
    await tx.save();

    ctx.user.interactionState = 'idle';
    ctx.user.tempData = undefined;
    await ctx.user.save();

    await ctx.reply(`❌ Withdrawal rejected. Balance refunded.`);

    // Notify user
    if (targetUser) {
        try {
            await ctx.api.sendMessage(targetUser.telegramId,
                `❌ <b>Withdrawal Rejected</b>\n\n💵 Amount: <b>${tx.amount.toLocaleString()} MMK</b>\n📝 Reason: ${reason}\n\n💰 Your balance has been refunded.`,
                { parse_mode: 'HTML' }
            );
        } catch (e) { }
    }
}

// Popular Channels Management (Admin)
export async function handleAdminPopular(ctx: BotContext) {
    await ctx.answerCallbackQuery();

    const allChannels = await MerchantChannel.find({ isActive: true }).limit(20);

    if (allChannels.length === 0) {
        const kb = new InlineKeyboard().text("🔙 Back", "admin_home");
        return ctx.editMessageText("🔥 <b>Popular Channels</b>\n\nNo active channels.", { reply_markup: kb, parse_mode: 'HTML' });
    }

    const kb = new InlineKeyboard();
    const now = new Date();
    for (const ch of allChannels) {
        const isActive = ch.isPopular && (!ch.popularExpiresAt || ch.popularExpiresAt > now);
        const icon = isActive ? "🔥" : "📢";
        kb.text(`${icon} ${ch.title}`, `toggle_popular_${ch._id}`).row();
    }
    kb.text("🔙 Back", "admin_home");

    await ctx.editMessageText("🔥 <b>Manage Popular Channels</b>\n\n🔥 = Popular, 📢 = Regular\nTap to toggle:", { reply_markup: kb, parse_mode: 'HTML' });
}

// Toggle Popular (from admin list - free for admin)
export async function handleTogglePopular(ctx: BotContext, channelId: string) {
    const channel = await MerchantChannel.findById(channelId);
    if (!channel) return ctx.answerCallbackQuery("Channel not found.");

    // Check limit (max 10)
    if (!channel.isPopular) {
        const count = await MerchantChannel.countDocuments({ isPopular: true });
        if (count >= 10) {
            return ctx.answerCallbackQuery("❌ Max 10 popular channels reached!");
        }
    }

    channel.isPopular = !channel.isPopular;
    if (channel.isPopular) {
        // Admin sets unlimited time (no expiry)
        channel.popularExpiresAt = undefined;
    }
    await channel.save();

    await ctx.answerCallbackQuery(channel.isPopular ? "🔥 Now Popular!" : "📢 Removed from Popular");
    await handleAdminPopular(ctx);
}

// Get Popular Pricing from DB (with fallback to defaults)
export async function getPopularPricing(): Promise<{ 1: number, 3: number, 6: number, 12: number }> {
    const setting = await Settings.findOne({ key: 'popular_pricing' });
    if (setting?.value) {
        return setting.value;
    }
    return DEFAULT_POPULAR_PRICING;
}

// Admin Pricing Management
export async function handleAdminPricing(ctx: BotContext) {
    await ctx.answerCallbackQuery();

    const pricing = await getPopularPricing();

    let msg = `💎 <b>Popular Channels Pricing</b>\n\n`;
    msg += `Current prices:\n`;
    msg += `• 1 Month: ${pricing[1].toLocaleString()} MMK\n`;
    msg += `• 3 Months: ${pricing[3].toLocaleString()} MMK\n`;
    msg += `• 6 Months: ${pricing[6].toLocaleString()} MMK\n`;
    msg += `• 12 Months: ${pricing[12].toLocaleString()} MMK\n\n`;
    msg += `Tap to edit:`;

    const kb = new InlineKeyboard()
        .text("1 Month", "set_price_1").text("3 Months", "set_price_3").row()
        .text("6 Months", "set_price_6").text("12 Months", "set_price_12").row()
        .text("🔙 Back", "admin_home");

    await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: 'HTML' });
}

// Set Price - Start input
export async function handleSetPriceStart(ctx: BotContext, months: string) {
    ctx.user.interactionState = 'awaiting_popular_price';
    ctx.user.tempData = { priceMonths: parseInt(months) };
    await ctx.user.save();

    await ctx.answerCallbackQuery();
    await ctx.reply(`Enter new price for ${months} month(s) in MMK:`, {
        reply_markup: { force_reply: true }
    });
}

// Process Price Input (called from stateHandler)
export async function processPopularPrice(ctx: BotContext, priceInput: string) {
    const months = ctx.user.tempData?.priceMonths;
    if (!months) {
        await ctx.reply("Session expired.");
        ctx.user.interactionState = 'idle';
        await ctx.user.save();
        return;
    }

    const price = parseInt(priceInput.replace(/,/g, ''));
    if (isNaN(price) || price < 1000) {
        await ctx.reply("Invalid price. Minimum 1,000 MMK. Try again:");
        return;
    }

    // Update pricing in DB
    const currentPricing = await getPopularPricing();
    const newPricing = { ...currentPricing, [months]: price };

    await Settings.findOneAndUpdate(
        { key: 'popular_pricing' },
        { value: newPricing },
        { upsert: true }
    );

    ctx.user.interactionState = 'idle';
    ctx.user.tempData = undefined;
    await ctx.user.save();

    await ctx.reply(`✅ Price for ${months} month(s) updated to ${price.toLocaleString()} MMK!`);
}
