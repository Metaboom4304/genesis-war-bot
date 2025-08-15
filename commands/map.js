export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const mapUrl = 'https://genesis-data.onrender.com';

    await bot.sendMessage(chatId, '🗺 Открой карту:', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🗺 Открыть карту',
            web_app: { url: mapUrl }
          }
        ]]
      }
    });
  }
};
