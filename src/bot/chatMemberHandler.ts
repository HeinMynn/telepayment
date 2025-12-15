import { bot } from './bot';

// Chat Member Update (Join Detection)
bot.on('chat_member', async (ctx) => {
    const update = ctx.chatMember;
    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;

    console.log(`Chat Member Update: ${ctx.chat.id}. User: ${update.new_chat_member.user.id}. ${oldStatus} -> ${newStatus}`);

    // Check if user JOINED (was left/kicked/restricted -> member/administrator/creator)
    // Actually simpler: if newStatus is 'member' or 'creator' or 'administrator' AND oldStatus was 'left' or 'kicked' or 'restricted'?
    // Typically join is 'left' -> 'member'.
    const isJoin = (oldStatus === 'left' || oldStatus === 'kicked') && (newStatus === 'member' || newStatus === 'administrator' || newStatus === 'creator');

    if (!isJoin) {
        console.log("Not a join event.");
        return;
    }

    const channelId = ctx.chat.id; // Telegram Channel ID
    const userId = update.new_chat_member.user.id;

    // Check if this channel is managed by us
    const { default: MerchantChannel } = await import('@/models/MerchantChannel');
    const channel = await MerchantChannel.findOne({ channelId: channelId });

    if (!channel) return; // Not our channel

    // Check if user has active subscription? Not strictly necessary if token link was used, but good to verify.
    // Or just send the "Go to Channel" link as requested.

    // Generate Link
    let channelLinkWithPost = "";
    if (channel.username) {
        channelLinkWithPost = `https://t.me/${channel.username}`;
    } else {
        const idStr = String(channel.channelId);
        const cleanId = idStr.replace(/^-100/, '');
        channelLinkWithPost = `https://t.me/c/${cleanId}/999999999`;
    }

    const { InlineKeyboard } = await import('grammy');
    const kb = new InlineKeyboard().url("📢 Go to Channel", channelLinkWithPost);

    try {
        // Send to Private Chat
        await ctx.api.sendMessage(userId, `Welcome to <b>${channel.title}</b>!`, {
            parse_mode: 'HTML',
            reply_markup: kb
        });
    } catch (e) {
        console.error("Failed to welcome user:", e);
        // User might not have started bot? But they just subscribed via bot.
    }
});
