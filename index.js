require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, DEVELOPER_IDS } = require('./config');
const setupBroadcast = require('./commands/broadcast');

const app = express();
app.get('/', (_req, res) => res.send('✅ Genesis War Bot is up'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Keepalive listening on port ${PORT}`));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const usersFile = path.join(dataDir, 'users.json');
let knownUsers = [];
try {
  knownUsers = JSON.parse(fs.readFileSync(usersFile));
} catch {
  knownUsers = [];
  fs.writeFileSync(usersFile, JSON.stringify(knownUsers, null, 2));
  console.log('📂 Создан пустой data/users.json');
}

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!knownUsers.includes(chatId)) {
    knownUsers.push(chatId);
    fs.writeFileSync(usersFile, JSON.stringify(knownUsers, null, 2));
    console.log(`➕ Новый пользователь: ${chatId}`);
  }
});

setupBroadcast(bot, DEVELOPER_IDS);

bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать в Genesis War Bot!');
});

bot.onText(/^\/status$/, (msg) => {
  bot.getMe().then(me => {
    const uptime = Math.floor(process.uptime());
    bot.sendMessage(msg.chat.id, `⏱ Uptime: ${uptime}s\n🤖 Бот: @${me.username}\n👤 Ваш ID: ${msg.chat.id}`);
  });
});

bot.onText(/^\/help$/, (msg) => {
  const helpText = `
📘 Справка:

/start — Приветствие
/status — Статус бота и ваш ID
/help — Эта справка
/broadcast <тип> <текст> — Рассылка для разработчиков

Доступные типы:
• important — ❗ Важное сообщение
• tech — 🛠️ Техобновление
• info — ℹ️ Информация
• warn — ⚠️ Предупреждение
• другое — 📢 Объявление
`;
  bot.sendMessage(msg.chat.id, helpText);
});

bot.getMe().then(me => {
  console.log(`🤖 Бот подключён как: ${me.username} ${me.id}`);
});

console.log('✅ Genesis War Bot запущен в режиме polling');
