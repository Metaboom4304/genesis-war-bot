export default {
  name: 'status',
  async execute(bot, msg) {
    const chatId = msg.chat.id;

    const launched = true; // Можно пробросить как переменную
    await bot.sendMessage(chatId,
      `📊 Status:\n` +
      `- Launched: ${launched}\n` +
      `- Bot enabled: ${isBotEnabled()}\n` +
      `- Registered users: ${getUserCount()}`
    );
  }
}
