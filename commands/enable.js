export default {
  name: '🔄 Enable map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    if (uid !== ADMIN_ID) return;

    const enableMsg = '🔓 Genesis is back online!';

    try {
      await updateMapStatus({
        enabled: true,
        message: enableMsg,
        theme: 'auto',
        disableUntil: null
      });
      await bot.sendMessage(chatId, '✅ Map enabled.');
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Failed to enable map.');
    }

    sendReplyMenu(bot, chatId, uid);
  }
}
