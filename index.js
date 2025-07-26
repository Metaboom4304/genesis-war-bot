// ╔═════════════════════════════════╗
// ║ 🔧 Инициализация и переменные  ║
// ╚═════════════════════════════════╝
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
require('dotenv').config();

const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

// ╔═════════════════════════════════╗
// ║ 📁 Загрузка users.json         ║
// ╚═════════════════════════════════╝
let users = {};
try {
  users = JSON.parse(fs.readFileSync('users.json', 'utf-8'));
} catch (e) {
  console.warn('❗ users.json повреждён или пуст');
  users = {};
}

// ╔═════════════════════════════════════════╗
// ║ 🛡️ Polling Guard — контроль конфликтов ║
// ╚═════════════════════════════════════════╝
let pollingLocked = false;
bot.on('polling_error', (error) => {
  console.error('⚠️ Polling error:', error.message);
  if (error.message.includes('terminated by other getUpdates request')) {
    pollingLocked = true;
  }
});

// ╔═════════════════════════════════╗
// ║ 🚀 Команда /start              ║
// ╚═════════════════════════════════╝
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (pollingLocked) {
    return bot.sendMessage(chatId, '⛔ Бот уже работает в другом процессе. Завершите лишний polling.');
  }

  const userId = msg.from.id;
  users[userId] = { username: msg.from.username || 'Без имени', timestamp: Date.now() };

  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  bot.sendMessage(chatId, `👋 Привет, ${users[userId].username}! Ты зарегистрирован.`);
});

// ╔═════════════════════════════════╗
// ║ 📊 Команда /status             ║
// ╚═════════════════════════════════╝
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;

  const userCount = Object.keys(users).length;
  const preview = Object.keys(users)
    .slice(0, 5)
    .map(id => `${id}: ${users[id].username}`)
    .join('\n');

  bot.sendMessage(chatId, `📦 Пользователей: ${userCount}\n🧾 Первые 5:\n${preview}`);
});
