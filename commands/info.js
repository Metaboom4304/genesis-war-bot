export default {
  name: '🤖 Info',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    try {
      const { status } = await fetchMapStatus();
      await bot.sendMessage(chatId,
        `🧐 Info:\n` +
        `- enabled: ${status.enabled}\n` +
        `- message: ${status.message}`
      );
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Failed to fetch info.');
    }

    sendReplyMenu(bot, chatId, uid);
  }
}
