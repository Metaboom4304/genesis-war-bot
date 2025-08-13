export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;

    // Прямая ссылка на твою карту
    const mapUrl = 'https://genesis-data.onrender.com';

    await bot.sendMessage(
      chatId,
      `🗺 Открыть карту можно по ссылке:\n${mapUrl}`,
      { disable_web_page_preview: false }
    );
  }
};
