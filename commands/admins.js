export default {
  name: '📑 Admins',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `📑 Admins:\n• ${ADMIN_ID}`);
  }
}
