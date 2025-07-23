require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, DEVELOPER_IDS, MAP_URL } = require('./config');
const setupBroadcast = require('./commands/broadcast');

// Keepalive
const app = express();
app.get('/', (_req, res) => res.send('✅ Bot is running'));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🟢 Keepalive listening on port ${PORT}`));

// Bot init
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// User base
const usersPath = path.join(__dirname, 'data/users.json');
let knownUsers = [];
try {
  knownUsers = JSON.parse(fs.readFileSync(usersPath));
} catch {
  fs.writeFileSync(usersPath, '[]', 'utf-8');
  console.log('📂 Создан пустой users.json');
}

// Universal listener
bot.on('message', (msg) => {
  const id = msg.chat.id;
  if (!knownUsers.includes(id)) {
    knownUsers.push(id);
    fs.writeFileSync(usersPath, JSON.stringify(knownUsers, null, 2));
    console.log(`➕ Новый пользователь: ${id}`);
  }

  console.log(`📩 ${msg.text} ← ${id}`);
});

// Команды
setupBroadcast(bot, DEVELOPER_IDS);

bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать в Genesis War Bot!');
});

bot.onText(/^\/status$/, async (msg) => {
  const me = await bot.getMe();
  const uptime = Math.floor(process.uptime());
  bot.sendMessage(msg.chat.id, `⏱ Аптайм: ${uptime}s\n🤖 Бот: @${me.username}\n👤 Ваш ID: ${msg.chat.id}`);
});

bot.onText(/^\/help$/, (msg) => {
  bot.sendMessage(msg.chat.id, `
📘 Команды:
/start — Приветствие
/status — Аптайм и ID
/map — Перейти к карте
/whoami — Ваш профиль
/debug — Техническая информация
/broadcast <тип> <текст> — Рассылка для разработчиков

Типы: tech, important, info, warn
  `);
});

bot.onText(/^\/map$/, (msg) => {
  bot.sendMessage(msg.chat.id, '📍 Перейти к карте Genesis:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗺️ Открыть карту', url: MAP_URL }],
      ],
    },
  });
});

bot.onText(/^\/whoami$/, (msg) => {
  const { id, username, first_name } = msg.from;
  const role = DEVELOPER_IDS.includes(id) ? '🛡️ Developer' : '👤 User';
  bot.sendMessage(msg.chat.id, `
🔍 Профиль:
ID: ${id}
Username: ${username || '—'}
Имя: ${first_name || '—'}
Роль: ${role}
  `);
});

bot.onText(/^\/debug$/, async (msg) => {
  const up = Math.floor(process.uptime());
  const me = await bot.getMe();
  const isDev = DEVELOPER_IDS.includes(msg.from.id);
  bot.sendMessage(msg.chat.id, `
🔧 Debug Info:
Polling: ✅
Bot: @${me.username}
User ID: ${msg.from.id}
Dev Access: ${isDev ? '✅' : '❌'}
Uptime: ${up}s
  `);
});

// Запуск
bot.getMe().then(me => {
  console.log(`🤖 Бот подключён как @${me.username} (${me.id})`);
});
console.log('✅ Genesis War Bot полностью запущен');
bot.on('callback_query', (query) => {
  const id = query.from.id;
  const data = query.data;

  // Ответ Telegram, чтобы убрать "часики"
  bot.answerCallbackQuery(query.id);

  console.log(`📦 Нажата кнопка: ${data} от ${id}`);

  if (data === 'open_dev_panel') {
    bot.sendMessage(id, '🛠️ DevPanel: скоро будет доступна');
  }
  else if (data === 'open_updates') {
    bot.sendMessage(id, '📜 Последние обновления: \n— Версия 0.15\n— Атмосферные тайлы\n— Debug-панель');
  }
  else {
    bot.sendMessage(id, `📌 Вы нажали: ${data}`);
  }
});
