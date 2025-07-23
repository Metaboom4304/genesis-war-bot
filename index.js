require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, DEVELOPER_IDS } = require('./config');

// ──────────────── Keepalive ────────────────
const app = express();
app.get('/', (_req, res) => res.send('✅ Genesis War Bot is up'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Keepalive listening on port ${PORT}`));

// ──────────────── Telegram Bot ────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.getMe().then(me => {
  console.log(`🤖 Бот: @${me.username} (${me.id}) — polling активен`);
});

// ──────────────── Users JSON ────────────────
const usersFile = path.join(__dirname, 'data', 'users.json');
let knownUsers = [];
try {
  knownUsers = JSON.parse(fs.readFileSync(usersFile));
} catch {
  fs.writeFileSync(usersFile, '[]', 'utf-8');
  console.log('📂 Создан пустой users.json');
}

// ──────────────── Авторизация пользователей ────────────────
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!knownUsers.includes(chatId)) {
    knownUsers.push(chatId);
    fs.writeFileSync(usersFile, JSON.stringify(knownUsers, null, 2));
    console.log(`➕ Новый пользователь: ${chatId}`);
  }

  console.log('📨 Сообщение:', msg.text, 'от', chatId);
});

// ──────────────── Команды ────────────────
bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать в Genesis War Bot!');
});

bot.onText(/^\/status$/, (msg) => {
  const up = Math.floor(process.uptime());
  bot.getMe().then(me => {
    bot.sendMessage(msg.chat.id, `⏱ Uptime: ${up}s\n🤖 Бот: @${me.username}\n👤 Ваш ID: ${msg.chat.id}`);
  });
});

bot.onText(/^\/help$/, (msg) => {
  bot.sendMessage(msg.chat.id, `
📘 Команды:
/start — Приветствие
/status — Статус бота и ваш ID
/help — Справка
/broadcast <тип> <текст> — Рассылка для разработчиков
`);
});

// ──────────────── Модуль рассылки ────────────────
require('./commands/broadcast')(bot, DEVELOPER_IDS);

// ──────────────── Запуск ────────────────
console.log('✅ Genesis War Bot запущен');
