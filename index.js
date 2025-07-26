require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, DEVELOPER_IDS, MAP_URL } = require('./config');

// Keepalive
const app = express();
app.get('/', (_req, res) => res.send('✅ Bot is running'));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🟢 Keepalive listening on port ${PORT}`));

// Bot init
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// User base
const usersPath = path.join(__dirname, 'data/users.json');
let knownUsers = [];
try {
  knownUsers = JSON.parse(fs.readFileSync(usersPath));
} catch {
  fs.writeFileSync(usersPath, '[]', 'utf-8');
  console.log('📂 Создан пустой users.json');
}

// Reload config
const configPath = path.join(__dirname, 'config.js');
function reloadConfig() {
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

// Логирование действий с картой
function logMapToggle(user, status) {
  const logEntry = `${new Date().toISOString()} — ${user} ${status ? 'включил' : 'отключил'} карту\n`;
  fs.appendFileSync(path.join(__dirname, 'logs.txt'), logEntry);
}

function logMapAccessAttempt(user) {
  const logEntry = `${new Date().toISOString()} — ${user} пытался открыть отключённую карту\n`;
  fs.appendFileSync(path.join(__dirname, 'logs.txt'), logEntry);
}

// Universal listener
bot.on('message', (msg) => {
  const id = msg.chat.id;
  if (!knownUsers.includes(id)) {
    knownUsers.push(id);
    fs.writeFileSync(usersPath, JSON.stringify(knownUsers, null, 2));
    console.log(`➕ Новый пользователь: ${id}`);
  }

  console.log(`📩 ${msg.text} ← ${id}`);
});

// Команда /broadcast из внешнего файла
const setupBroadcast = require('./commands/broadcast');
setupBroadcast(bot, DEVELOPER_IDS);

// Команды
bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать в Genesis War Bot!');
});

bot.onText(/^\/status$/, async (msg) => {
  const me = await bot.getMe();
  const uptime = Math.floor(process.uptime());
  const config = reloadConfig();
  bot.sendMessage(msg.chat.id, `⏱ Аптайм: ${uptime}s\n🤖 Бот: @${me.username}\n👤 Ваш ID: ${msg.chat.id}\n🗺️ Карта: ${config.mapEnabled ? '🟢 включена' : '🔴 отключена'}`);
});

bot.onText(/^\/help$/, (msg) => {
  bot.sendMessage(msg.chat.id, `
📘 Команды:
/start — Приветствие
/status — Аптайм и статус карты
/map — Перейти к карте
/maptoggle — Включить/отключить карту
/whoami — Ваш профиль
/debug — Техническая информация
/broadcast <тип> <текст> — Рассылка

Типы: tech, important, info, warn
  `);
});

bot.onText(/^\/devpanel$/, (msg) => {
  const id = msg.chat.id;
  const isDev = DEVELOPER_IDS.includes(id);

  if (!isDev) {
    bot.sendMessage(id, '⛔ Эта панель доступна только разработчикам');
    return;
  }

  const config = reloadConfig();

  bot.sendMessage(id, '🧭 Панель разработчика:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: config.mapEnabled ? '❌ Отключить карту' : '✅ Включить карту',
            callback_data: 'dev_toggle_map'
          }
        ],
        [
          { text: '📜 Показать последние логи', callback_data: 'dev_show_logs' },
          { text: '🧪 Проверить доступ', callback_data: 'dev_check_access' }
        ],
        [
          { text: '📦 Посмотреть roadmap', callback_data: 'dev_show_roadmap' }
        ]
      ]
    }
  });
});
bot.onText(/^\/whoami$/, (msg) => {
  const { id, username, first_name } = msg.from;
  console.log('[WHOAMI] Your ID:', id);
console.log('[WHOAMI] Developer IDs:', DEVELOPER_IDS);
console.log('[WHOAMI] Types:', typeof id, typeof DEVELOPER_IDS[0]);
  const role = DEVELOPER_IDS.includes(id) ? '🛡️ Developer' : '👤 User';
  bot.sendMessage(msg.chat.id, `
🔍 Профиль:
ID: ${id}
Username: ${username || '—'}
Имя: ${first_name || '—'}
Роль: ${role}
  `);
});

bot.onText(/^\/debug$/, async (msg) => {
  const up = Math.floor(process.uptime());
  const me = await bot.getMe();
  const isDev = DEVELOPER_IDS.includes(msg.from.id);
  bot.sendMessage(msg.chat.id, `
🔧 Debug Info:
Polling: ✅
Bot: @${me.username}
User ID: ${msg.from.id}
Dev Access: ${isDev ? '✅' : '❌'}
Uptime: ${up}s
  `);
});

// 🌍 Команда /map с проверкой mapEnabled
bot.onText(/^\/map$/, (msg) => {
  const config = reloadConfig();
  const id = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'unknown';

  if (!config.mapEnabled) {
    bot.sendMessage(id, '❌ Карта временно отключена администратором', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔁 Проверить снова', callback_data: 'check_map_status' }]
        ]
      }
    });
    logMapAccessAttempt(username);
    return;
  }

  bot.sendMessage(id, '📍 Перейти к карте Genesis:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗺️ Открыть карту', url: MAP_URL }],
      ],
    },
  });
});

// 🔀 Команда /maptoggle
bot.onText(/^\/maptoggle$/, (msg) => {
  const config = reloadConfig();
  const id = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'unknown';
  const isDev = DEVELOPER_IDS.includes(msg.from.id);

  if (!isDev) {
    bot.sendMessage(id, '⛔ Только разработчики могут переключать карту');
    return;
  }

  const statusText = config.mapEnabled ? '🟢 включена' : '🔴 отключена';
  bot.sendMessage(id, `Статус карты: ${statusText}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: config.mapEnabled ? '❌ Отключить карту' : '✅ Включить карту', callback_data: 'toggle_map' }]
      ]
    }
  });
});

// ⚙️ Обработка inline-кнопок
bot.on('callback_query', (query) => {
  const id = query.from.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || 'unknown';
  bot.answerCallbackQuery(query.id);

  // Переключение карты
  if (data === 'toggle_map') {
    const config = reloadConfig();
    if (!DEVELOPER_IDS.includes(id)) {
      bot.sendMessage(id, '⛔ Недостаточно прав для переключения карты');
      return;
    }

    config.mapEnabled = !config.mapEnabled;
    const newConfigText = `module.exports = ${JSON.stringify(config, null, 2)};\n`;
    fs.writeFileSync(configPath, newConfigText);

    bot.sendMessage(id, `Карта теперь ${config.mapEnabled ? '🟢 включена' : '🔴 отключена'}`);
    logMapToggle(username, config.mapEnabled);
    return;
  }

  // Проверка статуса карты
  if (data === 'check_map_status') {
    const config = reloadConfig();
    if (!config.mapEnabled) {
      bot.sendMessage(id, '⛔ Карта всё ещё отключена. Попробуйте позже.');
    } else {
      bot.sendMessage(id, '✅ Карта снова активна:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗺️ Перейти к карте', url: MAP_URL }]
          ]
        }
      });
    }
    return;
  }

  // Прочие действия
  if (data === 'open_dev_panel') {
    bot.sendMessage(id, '🛠️ DevPanel: скоро будет доступна');
  } else if (data === 'open_updates') {
    bot.sendMessage(id, '📜 Последние обновления: \n— Версия 0.15\n— Атмосферные тайлы\n— Debug-панель');
  } else {
    bot.sendMessage(id, `📌 Вы нажали: ${data}`);
  }
});

// Запуск
bot.getMe().then(me => {
  console.log(`🤖 Бот подключён как @${me.username} (${me.id})`);
});
console.log('✅ Genesis War Bot полностью запущен');
