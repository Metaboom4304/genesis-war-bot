// index.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// 🔑 Инициализация токена
const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error('❌ TELEGRAM_TOKEN не указан в .env');
  process.exit(1);
}

// 🚀 Инициализация бота
const bot = new TelegramBot(token, { polling: true });
console.log('[BOT] Запущен в режиме polling');

// 🧠 Утилиты
const loadMemory = () => JSON.parse(fs.readFileSync('./memory.json'));
const saveMemory = (mem) => fs.writeFileSync('./memory.json', JSON.stringify(mem, null, 2));
const loadRoadmap = () => fs.readFileSync('./roadmap.json', 'utf-8');
const loadLogs = () => fs.readFileSync('./logs.txt', 'utf-8');

// 📩 /start — приветствие
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  bot.sendMessage(id, '👋 Добро пожаловать!\nИспользуй /devpanel для инструментов разработчика.');
});

// 🛠 /devpanel — открытие панели
bot.onText(/\/devpanel/, (msg) => {
  const id = msg.chat.id;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔁 Переключить карту', callback_data: 'dev_toggle_map' }],
      [{ text: '📄 Показать логи', callback_data: 'dev_show_logs' }],
      [{ text: '🛣 Показать roadmap', callback_data: 'dev_show_roadmap' }],
      [{ text: '👤 Проверить доступ', callback_data: 'dev_check_access' }],
      [{ text: '🪵 Переключить debugMode', callback_data: 'dev_debug_toggle' }]
    ]
  };
  bot.sendMessage(id, '⚙️ Панель разработчика:\nВыбери действие:', {
    reply_markup: keyboard
  });
});

// 🐞 /debug — проверка флагов
bot.onText(/\/debug/, (msg) => {
  const id = msg.chat.id;
  const memory = loadMemory();
  bot.sendMessage(id, `🧪 Debug:\nmapEnabled = ${memory.mapEnabled ? '🟢 Да' : '🔴 Нет'}\ndebugMode = ${memory.debugMode ? '🟡 Включён' : '⚪️ Выключен'}`);
});

// 🎛 Обработка inline-кнопок
bot.on('callback_query', (query) => {
  const id = query.from.id;
  const data = query.data;
  const username = query.from.username || 'без username';
  bot.answerCallbackQuery(query.id);

  if (data === 'dev_toggle_map') {
    const memory = loadMemory();
    memory.mapEnabled = !memory.mapEnabled;
    saveMemory(memory);
    fs.appendFileSync('./logs.txt', `[${new Date().toISOString()}] ${username} toggled map → ${memory.mapEnabled}\n`);
    bot.sendMessage(id, `🗺 Карта теперь: ${memory.mapEnabled ? '🟢 Включена' : '🔴 Отключена'}`);
  }

  else if (data === 'dev_show_logs') {
    const logs = loadLogs();
    const tail = logs.split('\n').slice(-10).join('\n');
    bot.sendMessage(id, `📄 Последние логи:\n\n${tail || '— Нет записей'}`);
  }

  else if (data === 'dev_show_roadmap') {
    try {
      const roadmap = loadRoadmap();
      bot.sendMessage(id, `🛣 Roadmap:\n\n${roadmap}`);
    } catch {
      bot.sendMessage(id, '⚠️ Не удалось загрузить roadmap.json');
    }
  }

  else if (data === 'dev_check_access') {
    const memory = loadMemory();
    bot.sendMessage(id, `👤 Доступ:\nВаш ID: ${id}\nКарта: ${memory.mapEnabled ? '🟢 Включена' : '🔴 Отключена'}\nDebugMode: ${memory.debugMode ? '🪵 Активен' : '⚪️ Нет'}`);
  }

  else if (data === 'dev_debug_toggle') {
    const memory = loadMemory();
    memory.debugMode = !memory.debugMode;
    saveMemory(memory);
    fs.appendFileSync('./logs.txt', `[${new Date().toISOString()}] ${username} toggled debug → ${memory.debugMode}\n`);
    bot.sendMessage(id, `🪵 DebugMode: ${memory.debugMode ? 'Включён' : 'Выключен'}`);
  }

  else {
    bot.sendMessage(id, `⚠️ Неизвестная кнопка: ${data}`);
  }
});

// 🚫 Ошибки polling-а
bot.on('polling_error', (err) => {
  console.error('[ERROR] Polling:', err.code || err.message);
});
