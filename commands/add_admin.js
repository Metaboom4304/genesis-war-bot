export default {
  name: '👥 Add admin',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    if (uid !== ADMIN_ID) return;

    await bot.sendMessage(chatId, '👥 Add admin not implemented.');

    sendReplyMenu(bot, chatId, uid);
  }
}
