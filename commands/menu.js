export default {
  name: 'menu',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    sendReplyMenu(bot, chatId, uid);
  }
}
