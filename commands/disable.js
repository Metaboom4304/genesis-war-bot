export default {
  name: '⚠️ Disable map',
  async execute(bot, msg) {
    const uid = String(msg.from.id);
    const chatId = msg.chat.id;

    if (uid !== ADMIN_ID) return;

    disablePending.add(uid);

    await bot.sendMessage(chatId, '⚠️ Confirm disabling map:', {
      reply_markup: { force_reply: true }
    });
  }
}
