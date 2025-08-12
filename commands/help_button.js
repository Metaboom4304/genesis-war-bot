export default {
  name: '❓ Help',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    await bot.sendMessage(chatId,
      '❓ Help:\n– Use the menu buttons\n– /help for commands\n– Contact admin if needed'
    );

    sendReplyMenu(bot, chatId, uid);
  }
}
