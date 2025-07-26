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

// Broadcast команда
const setupBroadcast = require('./commands/broadcast');
setupBroadcast(bot, DEVELOPER_IDS);

// Команды
bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать в Genesis War Bot!');
});

bot.onText(/^\/status$/, async (msg) => {
  const me = await bot.getMe();
  const uptime = Math.floor(process.uptime());
  bot.sendMessage(msg.chat.id, `⏱ Аптайм: ${uptime}s\n🤖 Бот: @${me.username}\n👤 Ваш ID: ${msg.chat.id}`);
});

bot.onText(/^\/help$/, (msg) => {
  bot.sendMessage(msg.chat.id, `
📘 Команды:
/start — Приветствие
/status — Аптайм и ID
/map — Перейти к карте
/maptoggle — Включить/отключить карту
/whoami — Ваш профиль
/debug — Техническая информация
/broadcast <тип> <текст> — Рассылка для разработчиков

Типы: tech, important, info, warn
  `);
});

bot.onText(/^\/map$/, (msg) => {
  bot.sendMessage(msg.chat.id, '📍 Перейти к карте Genesis:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗺️ Открыть карту', url: MAP_URL }],
      ],
    },
  });
});

bot.onText(/^\/whoami$/, (msg) => {
  const { id, username, first_name } = msg.from;
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

// 🗺️ Команда maptoggle
const configPath = path.join(__dirname, 'config.js');
function reloadConfig() {
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

function logMapToggle(user, status) {
  const logEntry = `${new Date().toISOString()} — ${user} ${status ? 'включил' : 'отключил'} карту\n`;
  fs.appendFileSync(path.join(__dirname, 'logs.txt'), logEntry);
}

bot.onText(/^\/maptoggle$/, (msg) => {
  const id = msg.chat.id;
  const config = reloadConfig();
  const statusText = config.mapEnabled ? '🟢 включена' : '🔴 отключена';

  bot.sendMessage(id, `Статус карты: ${statusText}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: config.mapEnabled ? '❌ Отключить карту' : '✅ Включить карту', callback_data: 'toggle_map' }]
      ]
    }
  });
});

// 📦 Обработка кнопок
bot.on('callback_query', (query) => {
  const id = query.from.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || 'unknown';

  bot.answerCallbackQuery(query.id);

  // 🔁 Переключение карты
  if (data === 'toggle_map') {
    const config = reloadConfig();
    config.mapEnabled = !config.mapEnabled;
    const newConfigText = `module.exports = ${JSON.stringify(config, null, 2)};\n`;
    fs.writeFileSync(configPath, newConfigText);

    bot.sendMessage(id, `Карта теперь ${config.mapEnabled ? '🟢 включена' : '🔴 отключена'}`);
    logMapToggle(username, config.mapEnabled);
    return;
  }

  // Другие кнопки
  if (data === 'open_dev_panel') {
    bot.sendMessage(id, '🛠️ DevPanel: скоро будет доступна');
  }
  else if (data === 'open_updates') {
    bot.sendMessage(id, '📜 Последние обновления: \n— Версия 0.15\n— Атмосферные тайлы\n— Debug-панель');
  }
  else {
    bot.sendMessage(id, `📌 Вы нажали: ${data}`);
  }
});

// Запуск
bot.getMe().then(me => {
  console.log(`🤖 Бот подключён как @${me.username} (${me.id})`);
});
console.log('✅ Genesis War Bot полностью запущен');
