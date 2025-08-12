export default {
  name: 'help',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    await bot.sendMessage(chatId,
      '📖 Commands:\n' +
      '/start — register\n' +
      '/status — bot status\n' +
      '/menu — show menu'
    );
    sendReplyMenu(bot, chatId, uid);
  }
}
