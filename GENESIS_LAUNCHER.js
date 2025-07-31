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

// ╔══════════════════════════════════════╗
// ║ 🧾 Работа с users.json                ║
// ╚══════════════════════════════════════╝
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

function getUserCount() {
  try {
    const raw   = fs.readFileSync(usersPath, 'utf8');
    const users = JSON.parse(raw);
    return Object.keys(users).length;
  } catch {
    return 0;
  }
}

// ╔══════════════════════════════════════╗
// ║ 📣 Рассылка и логика broadcast        ║
// ╚══════════════════════════════════════╝
async function broadcastAll(bot, message) {
  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  } catch { /* ignore */ }

  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, `📣 Объявление:\n${message}`);
    } catch (err) {
      console.error(`⚠️ Не удалось отправить ${uid}:`, err.response?.body || err);
      // при 403 – удаляем из списка
      if (err.response?.statusCode === 403) {
        delete users[uid];
        console.log(`🗑 Удалён заблокировавший бот пользователь: ${uid}`);
      }
    }
  }
  // сохраняем обновлённый список
  try {
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  } catch {}
}

// ╔═════════════════════════════════╗
// ║ 🤖 Инициализация и запуск Bot  ║
// ╚═════════════════════════════════╝
activateBotFlag();
const bot = new TelegramBot(TOKEN, { polling: true });
let launched = false;

// глобальный обработчик ошибок API
bot.on('error', err => {
  console.error('💥 Telegram API error:', err.code, err.response?.body || err);
});
bot.on('polling_error', err =>
  console.error('📡 Polling error:', err.code, err.response?.body || err)
);

// логируем все входящие сообщения
bot.on('message', msg => {
  console.log(`📨 [${msg.chat.id}] ${msg.from.username || 'unknown'}: ${msg.text}`);
});

bot.getMe().then(me => {
  console.log(`✅ GENESIS активен как @${me.username}`);
  launched = true;
});

// ╔═══════════════════════════════════╗
// ║ 🏠 Главное меню (общее)            ║
// ╚═══════════════════════════════════╝
function sendMainMenu(bot, chatId, uid) {
  uid = String(uid);
  const userKb = [
    [{ text: '🧾 Info',     callback_data: 'info' }],
    [{ text: '🛣️ Roadmap', callback_data: 'roadmap' }],
    [{ text: '🌐 Ссылки',   callback_data: 'links' }],
    [{ text: '🗺️ Карта',    url: 'https://metaboom4304.github.io/genesis-data/' }],
    [{ text: '❓ Помощь',    callback_data: 'help' }]
  ];

  const adminKb = uid === ADMIN_ID
    ? [
        [{ text: '📃 Логи',            callback_data: 'logs' }],
        [{ text: '🟢 Включить карту',  callback_data: 'map_enable' }],
        [{ text: '⚠️ Выключить карту', callback_data: 'map_disable_confirm' }],
        [{ text: '👥 Добавить админа',  callback_data: 'add_admin' }],
        [{ text: '📑 Список админов',   callback_data: 'list_admins' }],
        [{ text: '📢 Рассылка',         callback_data: 'broadcast' }]
      ]
    : [];

  bot.sendMessage(chatId, '🏠 Главное меню', {
    reply_markup: { inline_keyboard: [...userKb, ...adminKb] }
  }).catch(console.error);
}

// ╔═══════════════════════════════════╗
// ║ ⚙️ Стандартные команды            ║
// ╚═══════════════════════════════════╝

// /start — регистрация + меню
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;
  const uid    = msg.from.id;
  registerUser(uid);
  bot.sendMessage(chatId, '🚀 Добро пожаловать! Вы успешно зарегистрированы.')
    .then(() => sendMainMenu(bot, chatId, uid))
    .catch(console.error);
});

// /help — справка
bot.onText(/\/help/, msg => {
  bot.sendMessage(msg.chat.id,
    '📖 Команды:\n' +
    '/start — регистрация + меню\n' +
    '/status — состояние бота\n' +
    '/menu — показать меню\n' +
    '/poweroff, /poweron, /restart — управление (админ)'
  ).catch(console.error);
});

// /status — инфо о боте
bot.onText(/\/status/, msg => {
  bot.sendMessage(msg.chat.id,
    `📊 Статус:\n- Запущен: ${launched}\n- Активен: ${isBotEnabled()}\n- Юзеров: ${getUserCount()}`
  ).catch(console.error);
});

// /menu — меню без регистрации
bot.onText(/\/menu/, msg => {
  sendMainMenu(bot, msg.chat.id, msg.from.id);
});

// power commands
bot.onText(/\/poweroff/, msg => {
  deactivateBotFlag();
  bot.sendMessage(msg.chat.id, '🛑 Бот остановлен.').then(() => process.exit(0)).catch(console.error);
});

bot.onText(/\/poweron/, msg => {
  if (!isBotEnabled()) {
    activateBotFlag();
    bot.sendMessage(msg.chat.id, '✅ Бот включён. Перезапустите.').catch(console.error);
  } else {
    bot.sendMessage(msg.chat.id, '⚠️ Уже активен.').catch(console.error);
  }
});

bot.onText(/\/restart/, msg => {
  deactivateBotFlag();
  activateBotFlag();
  bot.sendMessage(msg.chat.id, '🔄 Перезапуск…')
    .then(() => process.exit(0))
    .catch(console.error);
});

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
      bot.sendMessage(chatId, '🧾 Версия: 1.0.0\n👨‍💻 Авторы: GENESIS').catch(console.error);
      break;
    case 'roadmap':
      bot.sendMessage(chatId,
        '🛣️ Roadmap:\n1. Запуск\n2. Обновления\n3. Новые фичи'
      ).catch(console.error);
      break;
    case 'links':
      bot.sendMessage(chatId, '🌐 Сайт: https://example.com').catch(console.error);
      break;
    case 'help':
      bot.sendMessage(chatId,
        '📖 Помощь:\n' +
        '- /start — регистрация и меню\n' +
        '- /status — состояние\n' +
        '- /menu — меню'
      ).catch(console.error);
      break;

    // админские
    case 'logs':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, '📄 Логи: тайлов 344/500, ошибок 0').catch(console.error);
      break;
    case 'map_enable':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, '🟢 Карта включена.').catch(console.error);
      break;
    case 'map_disable_confirm':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '⚠️ Подтвердите отключение карты:', {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Подтвердить', callback_data: 'map_disable_final' }
            ]]
          }
        }).catch(console.error);
      }
      break;
    case 'map_disable_final':
      if (uid === ADMIN_ID) {
        deactivateBotFlag();
        bot.sendMessage(chatId, '🛑 Карта отключена. Пользователи уведомлены.').catch(console.error);
        broadcastAll(bot,
          '⛔ Карта временно отключена для техработ.\nСкоро вернёмся!'
        );
      }
      break;
    case 'add_admin':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, '👥 Назначение админа в разработке.').catch(console.error);
      break;
    case 'list_admins':
      if (uid === ADMIN_ID)
        bot.sendMessage(chatId, `📑 Админы: ${ADMIN_ID}`).catch(console.error);
      break;
    case 'broadcast':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid);
        bot.sendMessage(chatId,
          '✏️ Напишите текст для рассылки:',
          { reply_markup: { force_reply: true } }
        ).catch(console.error);
      }
      break;
    default:
      bot.sendMessage(chatId, '🤔 Неизвестная команда.').catch(console.error);
  }
});

// ╔══════════════════════════════════════════╗
// ║ 📨 Обработка ответов (broadcast)        ║
// ╚══════════════════════════════════════════╝
bot.on('message', async msg => {
  const uid = String(msg.from.id);
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text.includes('Напишите текст для рассылки')
  ) {
    broadcastPending.delete(uid);
    await broadcastAll(bot, msg.text);
    bot.sendMessage(uid, '✅ Рассылка выполнена.').catch(console.error);
  }
});

module.exports = bot;
