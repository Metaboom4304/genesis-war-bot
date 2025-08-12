export default {
  name: '📃 Logs',
  async execute(bot, msg) {
    const uid = String(msg.from.id);
    const chatId = msg.chat.id;

    if (uid !== ADMIN_ID) return;

    try {
      const logs = fs.readFileSync(logsPath, 'utf8');
      const chunkSize = 3500;

      for (let i = 0; i < logs.length; i += chunkSize) {
        await bot.sendMessage(chatId, `📃 Logs (part ${Math.floor(i/chunkSize)+1}):\n` + logs.slice(i, i + chunkSize));
      }
    } catch {
      await bot.sendMessage(chatId, '📃 Logs not available.');
    }

    sendReplyMenu(bot, chatId, uid);
  }
}
