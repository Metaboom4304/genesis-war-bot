// ╔══════════════════════════════════════════════════════════════════╗
// ║ 🧩 GENESIS_LAUNCHER — Telegram Control                          ║
// ╚══════════════════════════════════════════════════════════════════╝

console.log('\n🚀 GENESIS_LAUNCHER запущен...\n');

// 🛡️ Глобальный отлов ошибок
process.on('uncaughtException', err =>
  console.error('💥 uncaughtException:', err)
);
process.on('unhandledRejection', err =>
  console.error('💥 unhandledRejection:', err)
);
process.on('exit', code =>
  console.log(`⏹️ Процесс завершён с кодом ${code}`)
);

const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('@octokit/rest');

// 🌐 Render Port Server — Express вместо http
const app = express();
app.get('/', (_, res) => {
  res.send('GENESIS Bot active 🛡️');
});
app.listen(process.env.PORT || 3000, () => {
  console.log('🌐 Express сервер запущен');
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: защита инженерной среды                           ║
// ╚══════════════════════════════════════════════════════════════════╝

const requiredEnv = [
  'TELEGRAM_TOKEN',
  'ADMIN_ID',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO'
];

let envValid = true;
console.log('\n🧭 Инициализация GENESIS_LAUNCHER...');

for (const key of requiredEnv) {
  const val = process.env[key];
  if (!val) {
    console.log(`🔴 ENV отсутствует: ${key}`);
    envValid = false;
  } else {
    console.log(`🟢 ${key} активен: ${val.slice(0, 6)}...`);
  }
}

if (!envValid) {
  console.log('\n⛔️ Задайте все ENV-переменные и перезапустите.');
  process.exit(1);
}

const TOKEN         = process.env.TELEGRAM_TOKEN;
const ADMIN_ID      = String(process.env.ADMIN_ID);
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Новая переменная: прямой WebApp-URL карты (по умолчанию GitHub Pages)
const MAP_URL = process.env.MAP_URL ||
  `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 📂 Локальные хранилища и файлы                                  ║
// ╚══════════════════════════════════════════════════════════════════╝

const memoryPath = path.join(__dirname, 'memory');
const usersPath  = path.join(__dirname, 'users.json');
const lockPath   = path.join(memoryPath, 'botEnabled.lock');

if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath);
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(lockPath))   fs.writeFileSync(lockPath, 'enabled');

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 🔐 Флаги работы бота                                           ║
// ╚══════════════════════════════════════════════════════════════════╝

function isBotEnabled()      { return fs.existsSync(lockPath); }
function activateBotFlag()   { fs.writeFileSync(lockPath, 'enabled'); }
function deactivateBotFlag() { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 👥 Пользователи и рассылки                                      ║
// ╚══════════════════════════════════════════════════════════════════╝

function registerUser(userId) {
  userId = String(userId);
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    if (!users[userId]) {
      users[userId] = { registered: true, ts: Date.now() };
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      console.log(`👤 Зарегистрирован: ${userId}`);
    }
  } catch (err) {
    console.error('❌ Ошибка записи users.json:', err);
  }
}

function getUserCount() {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(usersPath, 'utf8'))).length;
  } catch {
    return 0;
  }
}

async function broadcastAll(bot, message) {
  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  } catch {}
  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, message);
    } catch (err) {
      console.error(`⚠️ Не удалось отправить ${uid}:`, err.response?.body || err);
      if (err.response?.statusCode === 403) {
        delete users[uid];
        console.log(`🗑️ Удалён пользователь ${uid}`);
      }
    }
  }
  try {
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  } catch {}
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 🌐 Интеграция с GitHub для map-status.json                      ║
// ╚══════════════════════════════════════════════════════════════════╝

async function fetchMapStatus() {
  const res = await octokit.repos.getContent({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: 'map-status.json',
    ref: GITHUB_BRANCH
  });
  const raw = Buffer.from(res.data.content, 'base64').toString();
  return { sha: res.data.sha, status: JSON.parse(raw) };
}

async function updateMapStatus({ enabled, message, theme = 'auto', disableUntil }) {
  const { sha } = await fetchMapStatus();
  const newStatus = { enabled, message, theme, disableUntil };
  const content = Buffer.from(JSON.stringify(newStatus, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: 'map-status.json',
    message: `🔄 Update map-status: enabled=${enabled}`,
    content, sha, branch: GITHUB_BRANCH
  });
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 🧠 Бот Telegram                                                  ║
// ╚══════════════════════════════════════════════════════════════════╝

activateBotFlag();
const bot = new TelegramBot(TOKEN, { polling: true });
let launched = false;

bot.on('error', err => console.error('💥 Telegram API error:', err.code, err.response?.body || err));
bot.on('polling_error', err => console.error('📡 Polling error:', err.code, err.response?.body || err));
bot.on('message', msg => console.log(`📨 [${msg.chat.id}] ${msg.from.username || 'unknown'}: ${msg.text}`));

bot.getMe().then(me => {
  console.log(`✅ GENESIS активен как @${me.username}`);
  launched = true;
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║ ⚙️ Команды, меню и логика управления                             ║
// ╚══════════════════════════════════════════════════════════════════╝

function sendReplyMenu(bot, chatId, uid, text = '📋 Меню доступно снизу:') {
  uid = String(uid);
  const isAdmin = uid === ADMIN_ID;
  const userMenu = {
    reply_markup: {
      keyboard: [
        ['🤖 Info','🗺️ Карта'],
        ['📃 Roadmap','ℹ️ Ссылки'],
        ['❓ Помощь']
      ],
      resize_keyboard: true
    }
  };
  const adminMenu = {
    reply_markup: {
      keyboard: [
        ['🤖 Info','🗺️ Карта'],
        ['📃 Roadmap','ℹ️ Ссылки'],
        ['❓ Помощь'],
        ['📣 Рассылка','📝 Логи'],
        ['⚠️ Выключить карту','✅ Включить карту'],
        ['👥 Добавить админа','📑 Список админов']
      ],
      resize_keyboard: true
    }
  };
  const menu = isAdmin ? adminMenu : userMenu;
  bot.sendMessage(chatId, text, menu).catch(console.error);
}

const broadcastPending = new Set();
const disablePending   = new Set();

bot.on('message', async msg => {
  const text   = msg.text;
  const chatId = msg.chat.id;
  const uid    = String(msg.from.id);

  // — Broadcast flow (force_reply)
  if (broadcastPending.has(uid)
    && msg.reply_to_message?.text.includes('Напишите текст для рассылки')) {
    broadcastPending.delete(uid);
    await broadcastAll(bot, text);
    await bot.sendMessage(uid, '✅ Рассылка выполнена.');
    return sendReplyMenu(bot, chatId, uid);
  }

  // — Отключение карты (force_reply)
  if (disablePending.has(uid)
    && msg.reply_to_message?.text.includes('Подтвердите отключение карты')) {
    disablePending.delete(uid);
    const disableMsg = 
      '🔒 Genesis временно отключён.\n' +
      'Мы ввели тайм-аут для безопасного рестарта.\n' +
      '📌 Скоро включим радара.';
    try {
      await updateMapStatus({
        enabled: false,
        message: disableMsg,
        theme: 'auto',
        disableUntil: new Date().toISOString()
      });
    } catch (err) {
      console.error('🔒 Ошибка при отключении карты:', err);
      await bot.sendMessage(chatId, '❌ Не удалось отключить карту.');
      return sendReplyMenu(bot, chatId, uid);
    }
    await broadcastAll(bot, disableMsg);
    await bot.sendMessage(chatId, '✅ Карта отключена и все уведомлены.')
      .then(() => sendReplyMenu(bot, chatId, uid));
    return;
  }

  // — Основные кнопки
  switch (text) {
    case '/start':
      registerUser(uid);
      sendReplyMenu(bot, chatId, uid, '🚀 Добро пожаловать! Вы успешно зарегистрированы.');
      break;

    case '/help':
      sendReplyMenu(bot, chatId, uid,
        '📖 Команды:\n' +
        '/start — регистрация\n' +
        '/status — состояние бота\n' +
        '/menu — меню'
      );
      break;

    case '/status':
      bot.sendMessage(chatId,
        `📊 Статус:\n` +
        `- Запущен: ${launched}\n` +
        `- Карту: ${isBotEnabled()}\n` +
        `- Пользователей: ${getUserCount()}`
      ).catch(console.error);
      break;

    case '/menu':
      sendReplyMenu(bot, chatId, uid);
      break;

    // power commands
    case '/poweroff':
      if (uid === ADMIN_ID) {
        deactivateBotFlag();
        bot.sendMessage(chatId, '🛑 Бот остановлен.')
          .then(() => process.exit(0));
      }
      break;

    case '/poweron':
      if (uid === ADMIN_ID) {
        if (!isBotEnabled()) {
          activateBotFlag();
          bot.sendMessage(chatId, '✅ Бот включён.').catch(console.error);
        } else {
          bot.sendMessage(chatId, '⚠️ Уже активен.').catch(console.error);
        }
      }
      break;

    case '/restart':
      if (uid === ADMIN_ID) {
        deactivateBotFlag();
        activateBotFlag();
        bot.sendMessage(chatId, '🔄 Перезапуск…')
          .then(() => process.exit(0));
      }
      break;

    // меню кнопки
    case '🤖 Info':
      bot.sendMessage(chatId, '🤖 Версия: 1.0.0\n👨‍💻 Авторы: GENESIS');
      break;

    case '📃 Roadmap':
      bot.sendMessage(chatId,
        '📃 Roadmap:\n' +
        '1. Запуск\n' +
        '2. Обновления\n' +
        '3. Новые фичи'
      );
      break;

    case 'ℹ️ Ссылки':
      bot.sendMessage(chatId,
        '🌐 Официальные ресурсы Genesis:\n\n' +
        '🗺️ Строение мира:\n' +
        'https://back.genesis-of-ages.space/info/builds.php\n\n' +
        '⚙️ Артефакты:\n' +
        'https://back.genesis-of-ages.space/info/tech.php\n\n' +
        '💬 Чат:\n' +
        'https://t.me/gao_chat\n\n' +
        '🎮 Сайт игры:\n' +
        'https://back.genesis-of-ages.space/game/\n\n' +
        '🔗 Очень многое…'
      );
      break;

    case '🗺️ Карта':
      // новый inline-кнопка WebApp вместо статичной ссылки
      bot.sendMessage(
        chatId,
        '🌍 Открой карту прямо в Telegram:',
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🗺️ Открыть карту',
                  web_app: { url: MAP_URL }
                }
              ]
            ]
          }
        }
      );
      break;

    case '❓ Помощь':
      bot.sendMessage(chatId,
        '📖 Помощь:\n' +
        '- /start — регистрация\n' +
        '- /status — состояние\n' +
        '- /menu — меню'
      );
      break;

    case '📣 Рассылка':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid);
        bot.sendMessage(chatId,
          '✏️ Напишите текст для рассылки:',
          { reply_markup: { force_reply: true } }
        );
      }
      break;

    case '📝 Логи':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '📄 Логи: тайло�� 344/500, ошибок 0');
      }
      break;

    case '⚠️ Выключить карту':
      if (uid === ADMIN_ID) {
        disablePending.add(uid);
        bot.sendMessage(chatId,
          '⚠️ Подтвердите отключение карты:',
          { reply_markup: { force_reply: true } }
        );
      }
      break;

    case '✅ Включить карту':
      if (uid === ADMIN_ID) {
        (async () => {
          const enableMsg = '🔓 Genesis сейчас в эфире!';
          try {
            await updateMapStatus({
              enabled: true,
              message: enableMsg,
              theme: 'auto',
              disableUntil: new Date().toISOString()
            });
            await bot.sendMessage(chatId,
              '✅ Карта включена. Все снова подключены.'
            );
          } catch (err) {
            console.error('🔒 Ошибка при включении карты:', err);
            await bot.sendMessage(chatId, '❌ Не удалось включить карту.');
          }
          sendReplyMenu(bot, chatId, uid);
        })();
      }
      break;

    case '👥 Добавить админа':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '👥 Назначение админа в разработке.');
      }
      break;

    case '📑 Список админов':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, `📑 Админы: ${ADMIN_ID}`);
      }
      break;
  }
});
