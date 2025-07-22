require('dotenv').config();
const fs          = require('fs');
const path        = require('path');
const express     = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { safeSend } = require('./utils/safeSend');
const { getUserKeyboard, getAdminKeyboard } = require('./bot/menu');
const { handleCallback, handleText }        = require('./bot/commands');

const DEVELOPER_IDS = (process.env.DEVELOPER_IDS || '')
  .split(',')
  .map(id => Number(id.trim()));
function isDev(chatId) {
  return DEVELOPER_IDS.includes(chatId);
}

const bot       = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const usersFile = path.join(__dirname, 'data', 'users.json');

// /start
bot.onText(/\/start/, msg => {
  const chatId  = msg.chat.id;
  const isAdmin = isDev(chatId);

  // 🌄 приветствие картинкой
  const imgPath = path.join(__dirname, 'assets', 'copilot_image.jpeg');
  if (fs.existsSync(imgPath)) {
    bot.sendPhoto(chatId, fs.createReadStream(imgPath), {
      caption: '🗺️ *Genesis War Map*\nДобро пожаловать!',
      parse_mode: 'Markdown'
    });
  } else {
    safeSend(bot, chatId, '🗺️ *Genesis War Map Bot запущен!*');
  }

  // ⌨️ кнопки
  const keyboard = isAdmin ? getAdminKeyboard() : getUserKeyboard();
  safeSend(bot, chatId, 'Выберите действие 👇', { reply_markup: keyboard.reply_markup });

  // 🌐 ссылка на карту
  safeSend(bot, chatId, '🌐 Перейти на карту онлайн:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗 Открыть карту', url: 'https://metaboom4304.github.io/genesis-data/' }]
      ]
    }
  });

  // 🗂️ добавление в users.json
  try {
    const raw   = fs.existsSync(usersFile) ? fs.readFileSync(usersFile, 'utf-8').trim() : '';
    const users = raw ? JSON.parse(raw).users : [];
    if (!users.includes(chatId)) {
      users.push(chatId);
      fs.writeFileSync(usersFile, JSON.stringify({ users }, null, 2));
    }
  } catch (err) {
    console.error('📁 Ошибка записи users.json:', err.message);
  }
});

// 🧩 inline-кнопки
bot.on('callback_query', q => handleCallback(bot, q));

// ✉️ сообщения + рассылка
bot.on('message', msg => {
  const chatId  = msg.chat.id;
  const replyTo = msg.reply_to_message?.text || '';

  // ✏️ обработка ответа на рассылку
  if (replyTo.includes('Введите текст для рассылки')) {
    try {
      const raw   = fs.readFileSync(usersFile, 'utf-8').trim();
      const users = JSON.parse(raw).users || [];

      users.forEach(uid => {
        if (uid !== chatId) {
          safeSend(bot, uid, `📢 Сообщение от админа:\n\n${msg.text}`);
        }
      });

      safeSend(bot, chatId, '✅ Рассылка выполнена.');
    } catch (err) {
      console.error('📢 Ошибка рассылки:', err);
      safeSend(bot, chatId, '❌ Ошибка при рассылке.');
    }
    return;
  }

  if (!msg.text || msg.text.startsWith('/start')) return;
  handleText(bot, msg);
});

// ⏱️ Keepalive‑таймер + лог
setInterval(() => {
  const now = new Date().toISOString();
  fs.appendFileSync('logs.txt', `🫀 Keepalive ping: ${now}\n`, 'utf-8');
}, 60_000);

// 🌐 Express‑сервер для UptimeRobot
const app  = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_, res) => {
  res.send('🟢 Genesis Bot is running');
});

app.listen(PORT, () => {
  console.log(`🌐 Express keepalive listening on port ${PORT}`);
});
