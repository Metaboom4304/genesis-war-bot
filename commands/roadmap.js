export default {
  name: '🛣 Roadmap',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);

    await bot.sendMessage(chatId,
      `🛣 Roadmap:\nhttps://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/ROADMAP.md`
    );

    sendReplyMenu(bot, chatId, uid);
  }
}
