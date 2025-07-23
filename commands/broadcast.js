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
  const usersPath = path.join(__dirname, '../data/users.json');

  bot.onText(/^\/broadcast\s+(\w+)\s+([\s\S]+)/, (msg, match) => {
    const senderId = msg.from.id;
    if (!developerIds.includes(senderId)) {
      return bot.sendMessage(msg.chat.id, '❌ Нет доступа к этой команде');
    }

    const typeKey = match[1].toLowerCase();
    const text = match[2].trim();
    const prefix = broadcastTypes[typeKey] || broadcastTypes.default;
    const finalMessage = `${prefix}\n\n${text}`;

    let recipients;
    try {
      recipients = JSON.parse(fs.readFileSync(usersPath));
    } catch (err) {
      console.error('Ошибка чтения users.json:', err);
      return bot.sendMessage(senderId, '❌ Не удалось загрузить список получателей');
    }

    let sentCount = 0;
    recipients.forEach(chatId => {
      bot.sendMessage(chatId, finalMessage)
        .then(() => sentCount++)
        .catch(console.error);
    });

    bot.sendMessage(
      senderId,
      `📤 Рассылка "${typeKey}" отправлена ${sentCount} из ${recipients.length} пользователям`
    );
  });
};
