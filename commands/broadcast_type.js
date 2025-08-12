import fs from 'fs';
import path from 'path';

const broadcastTypes = {
  default: '📢 Объявление',
  important: '❗ Важное сообщение',
  tech: '🛠️ Техобновление',
  info: 'ℹ️ Информация',
  warn: '⚠️ Предупреждение',
};

export default {
  name: 'broadcast', // используется только для авто-регистрации, но команда сама ловит через RegExp
  execute(bot, msg) {
    // эта команда не срабатывает напрямую — обрабатывается ниже вручную
  }
}

// 🎯 Дополнительный обработчик через RegExp
export function setupBroadcastRegex(bot, developerIds) {
  const usersPath = path.join(process.cwd(), 'data', 'users.json');

  bot.onText(/^\/broadcast\s+(\w+)\s+([\s\S]+)/, async (msg, match) => {
    const senderId = msg.from.id;
    const chatId = msg.chat.id;

    if (!developerIds.includes(senderId)) {
      return bot.sendMessage(chatId, '❌ У вас нет доступа к рассылке');
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
      return bot.sendMessage(chatId, '⚠️ Не удалось загрузить пользователей');
    }

    let sent = 0;
    for (const uid of Object.keys(recipients)) {
      try {
        await bot.sendMessage(uid, message);
        sent++;
      } catch (err) {
        console.error(`❌ Не удалось отправить ${uid}:`, err.message);
      }
    }

    bot.sendMessage(
      senderId,
      `📤 Рассылка "${type}" завершена: ${sent}/${Object.keys(recipients).length} пользователей`
    );
  });
}
