// commands/broadcast.js
const fs = require('fs');
const path = require('path');

const broadcastTypes = {
  default: '📢 Объявление',
  important: '❗ Важное сообщение',
  tech: '🛠️ Техническое обновление',
  info: 'ℹ️ Информация',
  warn: '⚠️ Предупреждение',
};

module.exports = function setupBroadcast(bot, developerIds) {
  bot.onText(/^\/broadcast (\w+)\s+(.+)/, (msg, match) => {
    const senderId = msg.from.id;
    if (!developerIds.includes(senderId)) return;

    const type = match[1];
    const text = match[2];
    const prefix = broadcastTypes[type] || broadcastTypes.default;
    const finalMessage = `${prefix}\n\n${text}`;

    // читаем список пользователей
    const usersPath = path.join(__dirname, '../data/users.json');
    let recipients = [];
    try {
      recipients = JSON.parse(fs.readFileSync(usersPath));
    } catch (err) {
      console.error('users.json not found or unreadable');
      return bot.sendMessage(senderId, '❌ Не удалось загрузить список получателей');
    }

    let sentCount = 0;
    recipients.forEach(chatId => {
      bot.sendMessage(chatId, finalMessage).then(() => sentCount++);
    });

    bot.sendMessage(senderId, `📤 Рассылка "${type}" отправлена ${recipients.length} пользователям`);
  });
};
