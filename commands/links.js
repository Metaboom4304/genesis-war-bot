export default {
  name: '🌐 Links',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    await bot.sendMessage(chatId,
      '🌐 Links:\n' +
      `• GitHub: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}\n` +
      '• Support: https://t.me/your_support_chat'
    );

    sendReplyMenu(bot, chatId, uid);
  }
}
