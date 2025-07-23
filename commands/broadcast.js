const fs = require('fs');
const path = require('path');

const broadcastTypes = {
  default: '📢 Объявление',
  important: '❗ Важное сообщение',
  tech: '🛠️ Техобновление',
  info: 'ℹ️ Информация',
  warn: '⚠️ Предупреждение',
};

module.exports = function setupBroadcast(bot, developerIds) {
  const usersPath = path.join(__dirname, '../data/users.json');

  bot.onText(/^\/broadcast\s+(\w+)\s+([\s\S]+)/, async (msg, match) => {
    const senderId = msg.from.id;
    if (!developerIds.includes(senderId)) {
      return bot.sendMessage(senderId, '❌ У вас нет доступа к рассылке');
    }

    const type = match[1].toLowerCase();
    const text = match[2].trim();
    const prefix = broadcastTypes[type] || broadcastTypes.default;
    const message = `${prefix}\n\n${text}`;

    let recipients;
    try {
      recipients = JSON.parse(fs.readFileSync(usersPath));
    } catch (err) {
      console.error('❌ Ошибка чтения users.json:', err);
      return bot.sendMessage(senderId, '⚠️ Не удалось загрузить пользователей');
    }

    let sent = 0;
    for (const chatId of recipients) {
      try {
        await bot.sendMessage(chatId, message);
        sent++;
      } catch (err) {
        console.error(`❌ Не удалось отправить ${chatId}:`, err.message);
      }
    }

    bot.sendMessage(
      senderId,
      `📤 Рассылка "${type}" завершена: ${sent}/${recipients.length} пользователей`
    );
  });
};
