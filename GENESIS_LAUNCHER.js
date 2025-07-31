// ╔══════════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control   ║
// ╚══════════════════════════════════════════╝

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ╔══════════════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: Защита инженерной среды        ║
// ╚══════════════════════════════════════════════╝
const requiredEnv = ['TELEGRAM_TOKEN', 'ADMIN_ID'];
let envValid = true;

console.log('\n🧭 Инициализация GENESIS_LAUNCHER...');
for (const key of requiredEnv) {
  const val = process.env[key];
  if (!val) {
    console.log(`🔴 ENV отсутствует: ${key}`);
    envValid = false;
  } else {
    console.log(`🟢 ${key} активен: ${val.slice(0,6)}...`);
  }
}
if (!envValid) {
  console.log('\n⛔️ Остановка: задайте все ENV-переменные');
  process.exit(1);
}

const TOKEN    = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID);

// ╔══════════════════════════════════════════╗
// ║ 📂 Пути к файлам и каталогу памяти      ║
// ╚══════════════════════════════════════════╝
const memoryPath = path.join(__dirname, 'memory');
const usersPath  = path.join(__dirname, 'users.json');
const lockPath   = path.join(memoryPath, 'botEnabled.lock');

// ┌──────────────────────────────────────────┐
// │ 📁 Проверка и создание окружения        │
// └──────────────────────────────────────────┘
if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath);
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(lockPath))  fs.writeFileSync(lockPath, 'enabled');

function isBotEnabled()   { return fs.existsSync(lockPath); }
function activateBotFlag(){ fs.writeFileSync(lockPath, 'enabled'); }
function deactivateBotFlag(){
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

/**
 * Регистрирует пользователя в users.json
 */
function registerUser(userId) {
  userId = String(userId);
  try {
    const raw   = fs.readFileSync(usersPath, 'utf8');
    const users = JSON.parse(raw);
    if (!users[userId]) {
      users[userId] = { registered: true, ts: Date.now() };
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      console.log(`👤 Зарегистрирован: ${userId}`);
    }
  } catch (err) {
    console.error('❌ Ошибка записи users.json:', err);
  }
}

/**
 * Проверяет, есть ли пользователь в базе
 */
function isRegistered(userId) {
  userId = String(userId);
  try {
    const raw   = fs.readFileSync(usersPath, 'utf8');
    const users = JSON.parse(raw);
    return Boolean(users[userId]);
  } catch {
    return false;
  }
}

/**
 * Возвращает количество пользователей
 */
function getUserCount() {
  try {
    const raw   = fs.readFileSync(usersPath, 'utf8');
    const users = JSON.parse(raw);
    return Object.keys(users).length;
  } catch {
    return 0;
  }
}

/**
 * Рассылает сообщение всем зарегистрированным
 */
function broadcastAll(bot, message) {
  let users = {};
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    users = JSON.parse(raw);
  } catch {}
  for (const uid of Object.keys(users)) {
    bot.sendMessage(uid, `📣 Объявление:\n${message}`);
  }
}

// ╔═════════════════════════════════╗
// ║ 🤖 Инициализация и запуск Bot  ║
// ╚═════════════════════════════════╝
activateBotFlag();
const bot = new TelegramBot(TOKEN, { polling: true });
let launched = false;

bot.getMe().then(me => {
  console.log(`✅ GENESIS активен как @${me.username}`);
  launched = true;
});

// ╔═══════════════════════════════════╗
// ║ 🏠 Главное меню (комбинированное)  ║
// ╚═══════════════════════════════════╝
function sendMainMenu(bot, chatId, uid) {
  uid = String(uid);

  // пользовательские кнопки
  const userKeyboard = [
    [{ text: '🧾 Info',     callback_data: 'info' }],
    [{ text: '🛣️ Roadmap', callback_data: 'roadmap' }],
    [{ text: '🌐 Ссылки',   callback_data: 'links' }],
    // карта теперь URL-кнопка
    [{ text: '🗺️ Карта',    url: 'https://metaboom4304.github.io/genesis-data/' }],
    [{ text: '❓ Помощь',    callback_data: 'help' }]
  ];

  // админские кнопки только для ADMIN_ID
  const adminKeyboard = uid === ADMIN_ID
    ? [
        [{ text: '📃 Логи',               callback_data: 'logs' }],
        [{ text: '🟢 Включить карту',     callback_data: 'map_enable' }],
        [{ text: '⚠️ Отключить карту',    callback_data: 'map_disable_confirm' }],
        [{ text: '👥 Добавить админа',     callback_data: 'add_admin' }],
        [{ text: '📑 Список админов',      callback_data: 'list_admins' }],
        [{ text: '📢 Рассылка',           callback_data: 'broadcast' }]
      ]
    : [];

  // объединяем
  const fullKeyboard = [...userKeyboard, ...adminKeyboard];

  bot.sendMessage(chatId, '🏠 Главное меню', {
    reply_markup: { inline_keyboard: fullKeyboard }
  });
}

// ╔═══════════════════════════════════╗
// ║ ⚙️ Стандартные команды            ║  
// ╚═══════════════════════════════════╝

// /start — регистрируем и сразу шлём меню внизу
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const uid    = String(msg.from.id);

  registerUser(uid);
  bot.sendMessage(chatId, '🚀 Добро пожаловать! Вы успешно зарегистрированы.')
    .then(() => sendMainMenu(bot, chatId, uid));
});

// /help — краткое описание
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📖 Команды:\n' +
    '/start — регистрация и меню\n' +
    '/status — проверить состояние\n' +
    '/menu — показать меню снизу\n' +
    '/poweroff, /poweron, /restart — управление ботом'
  );
});

// /status
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📊 Статус:\n- Запущен: ${launched}\n- Активен: ${isBotEnabled()}\n- Юзеров: ${getUserCount()}`
  );
});

// /menu — повторный вывод меню внизу
bot.onText(/\/menu/, (msg) => {
  sendMainMenu(bot, msg.chat.id, msg.from.id);
});

// power commands
bot.onText(/\/poweroff/, (msg) => {
  deactivateBotFlag();
  bot.sendMessage(msg.chat.id, '🛑 Бот остановлен.').then(() => process.exit());
});

bot.onText(/\/poweron/, (msg) => {
  if (!isBotEnabled()) {
    activateBotFlag();
    bot.sendMessage(msg.chat.id, '✅ Бот включён. Перезапустите.');
  } else {
    bot.sendMessage(msg.chat.id, '⚠️ Уже активен.');
  }
});

bot.onText(/\/restart/, (msg) => {
  deactivateBotFlag();
  activateBotFlag();
  bot.sendMessage(msg.chat.id, '🔄 Перезапуск…').then(() => process.exit());
});

bot.on('polling_error', err =>
  console.error('📡 Polling error:', err.message)
);

// ╔═══════════════════════════════════╗
// ║ 🎮 Обработка inline-кнопок       ║  
// ╚═══════════════════════════════════╝
const broadcastPending = new Set();

bot.on('callback_query', query => {
  const chatId = query.message.chat.id;
  const uid    = String(query.from.id);
  const data   = query.data;

  bot.answerCallbackQuery(query.id).catch(console.error);

  switch (data) {
    // пользовательские
    case 'info':
      bot.sendMessage(chatId, '🧾 Версия: 1.0.0\n👨‍💻 Авторы: команда GENESIS');
      break;
    case 'roadmap':
      bot.sendMessage(chatId,
        '🛣️ Roadmap:\n1. Запуск\n2. Технические обновления\n3. Новые фичи'
      );
      break;
    case 'links':
      bot.sendMessage(chatId, '🌐 Сайт: https://example.com');
      break;
    case 'help':
      bot.sendMessage(chatId,
        '📖 Помощь:\n' +
        '- /start — регистрация и меню\n' +
        '- /status — статус бота\n' +
        '- /menu — меню снизу'
      );
      break;

    // админские
    case 'logs':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, '📄 Логи карты: тайлов 344/500, ошибок 0');
      break;
    case 'map_enable':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, '🟢 Карта включена.');
      break;
    case 'map_disable_confirm':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '⚠️ Подтвердите отключение карты:', {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Подтвердить', callback_data: 'map_disable_final' }
            ]]
          }
        });
      }
      break;
    case 'map_disable_final':
      if (uid === ADMIN_ID) {
        deactivateBotFlag();
        bot.sendMessage(chatId, '🛑 Карта отключена. Пользователи уведомлены.');
        broadcastAll(bot,
          '⛔ Карта временно отключена для техработ.\nСкоро вернёмся!'
        );
      }
      break;
    case 'add_admin':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, '👤 Назначение админа в разработке.');
      break;
    case 'list_admins':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, `📃 Текущий админ: ${ADMIN_ID}`);
      break;
    case 'broadcast':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid);
        bot.sendMessage(chatId,
          '✏️ Напишите текст для рассылки:',
          { reply_markup: { force_reply: true } }
        );
      }
      break;

    default:
      bot.sendMessage(chatId, '🤔 Неизвестная кнопка.');
  }
});

// ╔══════════════════════════════════════════╗
// ║ 📨 Обработка ответов (broadcast)        ║  
// ╚══════════════════════════════════════════╝
bot.on('message', msg => {
  const uid = String(msg.from.id);
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text.includes('Напишите текст для рассылки')
  ) {
    broadcastPending.delete(uid);
    broadcastAll(bot, msg.text);
    bot.sendMessage(uid, '✅ Рассылка выполнена.');
  }
});

module.exports = bot;
