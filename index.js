// index.js
require('dotenv').config();              // Загрузка .env локально (необязательно на Railway)
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, DEVELOPER_IDS } = require('./config');

// ──────────────────────────────────────────────────────────────────────────────
// 1) KEEPALIVE-СЕРВЕР (Express)
// ──────────────────────────────────────────────────────────────────────────────
const app = express();
app.get('/', (_req, res) => res.send('✅ Genesis War Bot is up'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Keepalive listening on port ${PORT}`));

// ──────────────────────────────────────────────────────────────────────────────
// 2) ИНИЦИАЛИЗАЦИЯ TELEGRAM БОТА
// ──────────────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ──────────────────────────────────────────────────────────────────────────────
// 3) ПОДГОТОВКА users.json ДЛЯ РАССЫЛКИ
// ──────────────────────────────────────────────────────────────────────────────
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

// Автоматически логируем каждого, кто пишет боту
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!knownUsers.includes(chatId)) {
    knownUsers.push(chatId);
    fs.writeFileSync(usersFile, JSON.stringify(knownUsers, null, 2));
    console.log(`➕ New user added: ${chatId}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 4) ПОДКЛЮЧЕНИЕ КОМАНД
// ──────────────────────────────────────────────────────────────────────────────
// команда рассылки с типами
require('./commands/broadcast')(bot, DEVELOPER_IDS);

// Пример простых команд
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 Добро пожаловать в Genesis War Bot! Напиши /help для списка команд.'
  );
});

bot.onText(/\/status/, (msg) => {
  const up = Math.floor(process.uptime());
  bot.sendMessage(
    msg.chat.id,
    `⏱ Uptime: ${up}s\n👤 Ваш ID: ${msg.chat.id}`
  );
});

bot.onText(/\/help/, (msg) => {
  const helpText = `
Список команд:
/start               — Приветствие
/status              — Статус бота и ваш ID
/broadcast <type> <text> — Рассылка (доступно только разработчикам)
/help                — Эта справка

Типы для /broadcast:
• important — ❗ Важное
• tech      — 🛠 Техобновление
• info      — ℹ Информация
• warn      — ⚠️ Предупреждение
• любой другой — 📢 Объявление
`;
  bot.sendMessage(msg.chat.id, helpText);
});

bot.getMe().then(me => {
  console.log('🤖 Бот подключён как:', me.username, me.id);
}).catch(err => {
  console.error('❌ Ошибка Telegram getMe:', err);
});

console.log('✅ Genesis War Bot запущен в режиме polling');
