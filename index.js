// 📦 Импорт зависимостей
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// 🚀 Инициализация бота
const token = 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token, { polling: true });

// 🧠 Загрузка и сохранение состояния
const loadMemory = () => JSON.parse(fs.readFileSync('./memory.json'));
const saveMemory = (data) => fs.writeFileSync('./memory.json', JSON.stringify(data, null, 2));

// 🟢 Команды пользователя
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать!\nНапиши /devpanel чтобы открыть инструменты разработчика.');
});

bot.onText(/\/updates/, (msg) => {
  const changelog = fs.readFileSync('./changelog.txt', 'utf-8');
  bot.sendMessage(msg.chat.id, `📜 Changelog:\n\n${changelog}`);
});

bot.onText(/\/devpanel/, (msg) => {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔁 Переключить карту', callback_data: 'dev_toggle_map' }],
      [{ text: '📄 Показать логи', callback_data: 'dev_show_logs' }],
      [{ text: '🛣 Открыть roadmap', callback_data: 'dev_show_roadmap' }],
      [{ text: '👤 Проверить доступ', callback_data: 'dev_check_access' }],
      [{ text: '🪵 Переключить debugMode', callback_data: 'dev_debug_toggle' }]
    ]
  };
  bot.sendMessage(msg.chat.id, '⚙️ Dev-панель:\nВыбери действие:', {
    reply_markup: keyboard
  });
});


// 🎛 Обработка кнопок
bot.on('callback_query', async (query) => {
  const id = query.from.id;
  const data = query.data;
  const username = query.from.username || 'без username';
  const userInfo = `ID: ${id}\nUsername: ${username}`;
  bot.answerCallbackQuery(query.id);

  // 💠 Панель разработчика
  if (data === 'open_dev_panel') {
    bot.sendMessage(id, '⚙️ Dev-панель активна. Выбери действие выше.');
  }

  // 📜 Changelog
  else if (data === 'open_updates') {
    const changelog = fs.readFileSync('./changelog.txt', 'utf-8');
    bot.sendMessage(id, `📜 Changelog:\n\n${changelog}`);
  }

  // 🔁 Переключение карты
  else if (data === 'dev_toggle_map') {
    const memory = loadMemory();
    memory.mapEnabled = !memory.mapEnabled;
    saveMemory(memory);
    bot.sendMessage(id, `🗺 Карта теперь: ${memory.mapEnabled ? 'Включена' : 'Отключена'}`);
  }

  // 📄 Просмотр логов
  else if (data === 'dev_show_logs') {
    const logs = fs.readFileSync('./logs.txt', 'utf-8');
    bot.sendMessage(id, `📄 Логи:\n\n${logs.slice(-3000)}`);
  }

  // 🛣 Чтение roadmap
  else if (data === 'dev_show_roadmap') {
    const roadmap = fs.readFileSync('./roadmap.json', 'utf-8');
    bot.sendMessage(id, `🛣 Roadmap:\n\n${roadmap}`);
  }

  // 👤 Проверка доступа
  else if (data === 'dev_check_access') {
    bot.sendMessage(id, `🔎 Доступ:\n${userInfo}`);
  }

  // 🪵 Переключение debugMode
  else if (data === 'dev_debug_toggle') {
    const memory = loadMemory();
    memory.debugMode = !memory.debugMode;
    saveMemory(memory);
    bot.sendMessage(id, `🪵 DebugMode: ${memory.debugMode ? 'Активен' : 'Выключен'}`);
  }

  // 🚫 Неизвестная кнопка
  else {
    console.log(`⚠️ Неизвестная кнопка: ${data}`);
  }
});
