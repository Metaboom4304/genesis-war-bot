// ╔══════════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control   ║
// ╚══════════════════════════════════════════╝

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { sendUserMenu, sendAdminMenu } = require('./controlPanel');

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
  const raw   = fs.readFileSync(usersPath, 'utf8');
  const users = JSON.parse(raw);
  if (!users[userId]) {
    users[userId] = { registered: true, ts: Date.now() };
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    console.log(`👤 Зарегистрирован: ${userId}`);
  }
}

/**
 * Проверяет, есть ли пользователь в базе
 */
function isRegistered(userId) {
  const raw   = fs.readFileSync(usersPath, 'utf8');
  const users = JSON.parse(raw);
  return Boolean(users[userId]);
}

/**
 * Возвращает количество пользователей
 */
function getUserCount() {
  const raw   = fs.readFileSync(usersPath, 'utf8');
  const users = JSON.parse(raw);
  return Object.keys(users).length;
}

/**
 * Рассылает сообщение всем зарегистрированным
 */
function broadcastAll(bot, message) {
  const raw   = fs.readFileSync(usersPath, 'utf8');
  const users = JSON.parse(raw);
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
// ║ ⚙️ Стандартные команды            ║
// ╚═══════════════════════════════════╝
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📊 Статус:\n- Запущен: ${launched}\n- Активен: ${isBotEnabled()}\n- Юзеров: ${getUserCount()}`
  );
});

bot.onText(/\/menu/, (msg) => {
  const uid = msg.from.id;
  sendUserMenu(bot, msg.chat.id);
  sendAdminMenu(bot, msg.chat.id, uid);
});

bot.onText(/\/poweroff/, (msg) => {
  deactivateBotFlag();
  bot.sendMessage(msg.chat.id, '🛑 Бот остановлен. polling завершается…');
  process.exit();
});

bot.onText(/\/poweron/, (msg) => {
  if (!isBotEnabled()) {
    activateBotFlag();
    bot.sendMessage(msg.chat.id, '✅ Бот включён. Перезапустите.');
  } else {
    bot.sendMessage(msg.chat.id, '⚠️ Уже включён.');
  }
});

bot.onText(/\/restart/, (msg) => {
  deactivateBotFlag();
  activateBotFlag();
  bot.sendMessage(msg.chat.id, '🔄 Обновление… перезапуск.');
  process.exit();
});

bot.on('polling_error', err =>
  console.error('📡 Polling error:', err.message)
);

// ╔═══════════════════════════════════╗
// ║ 🎮 Обработка нажатий inline-кнопок║
// ╚═══════════════════════════════════╝
const broadcastPending = new Set();

bot.on('callback_query', query => {
  const chatId = query.message.chat.id;
  const uid    = String(query.from.id);
  const data   = query.data;

  switch (data) {
    // Пользовательские кнопки
    case 'start':
      registerUser(uid);
      bot.sendMessage(chatId, '✅ Вы успешно зарегистрированы.');
      break;

    case 'map':
      if (isRegistered(uid)) {
        bot.sendMessage(chatId, '🗺️ Открываем карту…');
      } else {
        bot.sendMessage(chatId, '🚫 Сначала нажмите «Старт» для регистрации.');
      }
      break;

    case 'help':
      bot.sendMessage(chatId,
        '📖 Помощь:\n' +
        '- Старт: регистрация\n' +
        '- Карта: доступна после регистрации\n' +
        '- Инфо, Roadmap, Ссылки'
      );
      break;

    case 'info':
      bot.sendMessage(chatId, '🧾 Версия: 1.0.0\n👨‍💻 Авторы: команда GENESIS');
      break;

    case 'roadmap':
      bot.sendMessage(chatId,
        '🛣️ Roadmap:\n' +
        '1. Запуск\n' +
        '2. Технические обновления\n' +
        '3. Новые фичи'
      );
      break;

    case 'links':
      bot.sendMessage(chatId, '🌐 Официальный сайт:\nhttps://example.com');
      break;

    // Админские кнопки
    case 'logs':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '📄 Логи карты: тайлов 344/500, ошибок 0');
      }
      break;

    case 'map_enable':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '🟢 Карта включена.');
      }
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
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '👤 Функция назначения админа в разработке.');
      }
      break;

    case 'list_admins':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, `📃 Админ-панель: единственный ID — ${ADMIN_ID}`);
      }
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
      bot.sendMessage(chatId, '🤔 Неизвестная команда.');
  }
});

// ╔══════════════════════════════════════════╗
// ║ 📨 Обработка ответов (broadcast)        ║
// ╚══════════════════════════════════════════╝
bot.on('message', msg => {
  const uid = String(msg.from.id);
  if (broadcastPending.has(uid) && msg.reply_to_message?.text.includes('Напишите текст для рассылки')) {
    broadcastPending.delete(uid);
    broadcastAll(bot, msg.text);
    bot.sendMessage(uid, '✅ Рассылка выполнена.');
  }
});
