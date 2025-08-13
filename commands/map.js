export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from?.id);

    try {
      // Пример сообщения — замени на свою логику показа карты
      await bot.sendMessage(
        chatId,
        '🗺 Карта доступна! Вот ссылка: https://example.com/map',
        { disable_web_page_preview: false }
      );
    } catch (err) {
      console.error(`❌ Ошибка при отправке карты пользователю ${uid}:`, err.message);
      await bot.sendMessage(chatId, '⚠️ Ошибка при получении карты.');
    }
  }
};
