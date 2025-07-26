const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const MAP_ENABLED = process.env.MAP_ENABLED === 'true';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

function loadUsers() {
  try {
    const rawData = fs.readFileSync('data/users.json');
    return JSON.parse(rawData);
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync('data/users.json', JSON.stringify(users, null, 2));
}

// 💾 Авторизация
bot.onText(/\/start/, (msg) => {
  const id = msg.from.id.toString();
  const users = loadUsers();

  if (!users[id]) {
    users[id] = {
      id,
      username: msg.from.username || '',
      role: 'user',
      joined: new Date().toISOString(),
    };
    saveUsers(users);
  }

  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать! Вы успешно авторизованы.');
});

// 🧭 Статус
bot.onText(/\/status/, (msg) => {
  const id = msg.from.id.toString();
  const users = loadUsers();
  const role = users[id]?.role || 'user';
  const isAdmin = role === 'admin' || role === 'dev';

  bot.sendMessage(msg.chat.id, `
🧪 Статус системы:
TELEGRAM_TOKEN: ${TELEGRAM_TOKEN}
DEBUG_MODE: ${DEBUG_MODE}
MAP_ENABLED: ${MAP_ENABLED}
USER_ROLE: ${role}
IS_ADMIN: ${isAdmin}
`);
});

// 🗺️ Карта
bot.onText(/\/map/, (msg) => {
  if (!MAP_ENABLED) {
    return bot.sendMessage(msg.chat.id, '🗺️ Карта временно отключена.');
  }

  bot.sendMessage(msg.chat.id, '🌍 Загрузка карты... [placeholder]');
});

// 🔐 Админ доступ
bot.onText(/\/admin/, (msg) => {
  const id = msg.from.id.toString();
  const users = loadUsers();
  const role = users[id]?.role || 'user';
  const isAdmin = role === 'admin' || role === 'dev';

  if (!isAdmin) {
    return bot.sendMessage(msg.chat.id, '⛔ Недостаточно прав.');
  }

  bot.sendMessage(msg.chat.id, `🔒 Админ доступ подтвержден. Ваша роль: ${role}`);
});
