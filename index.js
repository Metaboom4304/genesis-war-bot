// ┌────────────────────────────────┐
// │        🔧 Загрузка .env        │
// └────────────────────────────────┘
require('dotenv').config();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
console.log(`[ENV CHECK] TELEGRAM_TOKEN: ${TELEGRAM_TOKEN}`);

// ┌────────────────────────────────┐
// │        📦 Импорты модулей       │
// └────────────────────────────────┘
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// ┌────────────────────────────────┐
// │  🤖 Инициализация Telegram Bot │
// └────────────────────────────────┘
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.getMe()
  .then((me) => console.log(`🌐 Бот активен: @${me.username}`))
  .catch((err) => console.error('🚫 Ошибка Telegram:', err));

// ┌────────────────────────────────┐
// │  📁 Подключение users.json      │
// └────────────────────────────────┘
const USERS_PATH = path.join(__dirname, 'data', 'users.json');
let users = {};

try {
  const raw = fs.readFileSync(USERS_PATH, 'utf-8');
  users = JSON.parse(raw);
  console.log(`👤 Загружено ${Object.keys(users).length} пользователей`);
} catch (err) {
  console.error('⚠️ users.json не загружается:', err);
  users = {};
}

// ┌────────────────────────────────┐
// │   📌 Поддержка ролей и inline  │
// └────────────────────────────────┘
function getRole(id) {
  return users[id]?.role || 'user';
}

function isAdmin(id) {
  return getRole(id) === 'admin' || getRole(id) === 'dev';
}

function saveUsers() {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

// ┌────────────────────────────────┐
// │     🎮 Команда /start           │
// └────────────────────────────────┘
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!users[userId]) {
    users[userId] = {
      telegram_id: userId,
      role: 'user',
      registered_at: new Date().toISOString()
    };
    saveUsers();
    console.log(`📥 Зарегистрирован: ${userId}`);
  }

  const buttons = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛠 Статус системы', callback_data: 'status' }],
        isAdmin(userId)
          ? [{ text: '🔧 debugMode', callback_data: 'debug' }]
          : []
      ].filter(row => row.length > 0)
    }
  };

  bot.sendMessage(chatId, '👋 Добро пожаловать в систему GENESIS', buttons);
});

// ┌────────────────────────────────┐
// │      📶 Обработка кнопок        │
// └────────────────────────────────┘
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  if (query.data === 'status') {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, `📊 STATUS CHECK:\n- users.json: ${Object.keys(users).length} юзеров\n- Роль: ${getRole(userId)}\n- ENV токен: ${TELEGRAM_TOKEN ? '✅' : '❌'}`);
  }

  if (query.data === 'debug' && isAdmin(userId)) {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, `🔧 DEBUG MODE:\n- Telegram: polling active\n- ENV: ${TELEGRAM_TOKEN ? '✅ доступен' : '❌ нет токена'}\n- Бот: работает как @GENESIS`);
  }
});

// ┌────────────────────────────────┐
// │    📡 Polling errors логгер     │
// └────────────────────────────────┘
bot.on('polling_error', (err) => {
  console.error('📡 Polling error:', err.message);
});
