export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const username = msg.from?.username;

    try {
      const { status } = await fetchMapStatus();

      if (status?.disableUntil) {
        const until = new Date(status.disableUntil);
        if (!Number.isNaN(until.getTime()) && until > new Date()) {
          await bot.sendMessage(chatId, `🛑 Карта временно отключена до ${until.toLocaleString('ru-RU')}.`);
          return sendReplyMenu(bot, chatId, uid);
        }
      }

      if (!status?.enabled) {
        await bot.sendMessage(chatId, '🛑 Карта сейчас отключена.');
        return sendReplyMenu(bot, chatId, uid);
      }

      const messageToSend = status.message || '🗺 Карта доступна, но сообщение не задано.';
      await bot.sendMessage(chatId, messageToSend, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

    } catch (err) {
      await bot.sendMessage(chatId, '❌ Ошибка при получении карты.');
    }

    sendReplyMenu(bot, chatId, uid);
  }
}
