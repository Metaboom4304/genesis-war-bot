export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '🗺 Карта работает!');
  }
};
