const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'data', 'users.json');

// Загружаем users.json или создаём пустой объект
let users = {};
try {
  const raw = fs.readFileSync(usersPath, 'utf8');
  users = JSON.parse(raw);
} catch {
  console.warn('⚠️ users.json не найден — создаю пустой');
  users = {};
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}
// 📦 Загружаем переменные окружения
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const MAP_ENABLED = process.env.MAP_ENABLED === 'true';
const USER_ROLE = process.env.USER_ROLE || 'guest';
const IS_ADMIN = USER_ROLE === 'admin';

// 🚨 Проверка токена
if (!TELEGRAM_TOKEN) {
  console.error('❌ Отсутствует TELEGRAM_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// 🚀 Стартовый лог
console.log(`
🔰 Bot активирован!
🔐 TELEGRAM_TOKEN: загружен
🕵️ DEBUG_MODE: ${DEBUG_MODE ? 'включён' : 'отключён'}
🗺️ MAP_ENABLED: ${MAP_ENABLED ? 'включена' : 'отключена'}
🧙 Роль: ${USER_ROLE}
🛡️ Админ: ${IS_ADMIN}
`);

// 👋 Команда /start
bot.onText(/\/start/, (msg) => { const id = msg.from.id.toString();
const username = msg.from.username || "без username";

if (!users[id]) {
  users[id] = {
    username,
    role: "user",           // ← по умолчанию
    mapAccess: false,       // ← доступ к карте
    joinedAt: new Date().toISOString()
  };
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  console.log(`📝 Новый юзер записан: ${username} (${id})`);
}

bot.sendMessage(msg.chat.id, `👋 Привет, ${username}! Ты зарегистрирован как ${users[id].role}.`););

// 🧪 Диагностика /status
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, `
✅ Статус системы:
TELEGRAM_TOKEN: ✅
DEBUG_MODE: ${DEBUG_MODE}
MAP_ENABLED: ${MAP_ENABLED}
USER_ROLE: ${USER_ROLE}
IS_ADMIN: ${IS_ADMIN}
  `);
});

// 🗺️ Команда /map если активирована
if (MAP_ENABLED) {
  bot.onText(/\/map/, (msg) => {
    bot.sendMessage(msg.chat.id, '🗺️ Карта включена. Ваша роль: ' + USER_ROLE);
  });
}

// 🔐 Админ-команда /admin только если IS_ADMIN
if (IS_ADMIN) {
  bot.onText(/\/admin/, (msg) => {
    bot.sendMessage(msg.chat.id, '⚙️ Админ-панель активирована. Доступ открыт.');
  });
}

// 🐛 Debug логика
if (DEBUG_MODE) {
  bot.onText(/\/debug/, (msg) => {
    bot.sendMessage(msg.chat.id, '🐛 Debug-режим активен. Логирование разрешено.');
  });
}
