require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, DEVELOPER_IDS, MAP_URL } = require('./config');
const setupBroadcast = require('./commands/broadcast');

// ───── Keepalive ─────
const app = express();
app.get('/', (_req, res) => res.send('✅ Bot is up'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Keepalive listening on port ${PORT}`));

// ───── Bot Init ─────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.getMe().then(me => {
  console.log(`🤖 Бот: @${me.username} (${me.id}) — polling активен`);
});

// ───── Users DB ─────
const usersFile = path.join(__dirname, 'data', 'users.json');
let knownUsers = [];
try {
  knownUsers = JSON.parse(fs.readFileSync(usersFile));
} catch {
  fs.writeFileSync(usersFile, '[]');
  console.log('📂 Создан users.json');
}

bot.on('message', (msg) => {
  const id = msg.chat.id;
  if (!knownUsers.includes(id)) {
    knownUsers.push(id);
    fs.writeFileSync(usersFile, JSON.stringify(knownUsers, null, 2));
    console.log(`➕ Новый пользователь: ${id}`);
  }
  console.log('📨', msg.text, 'от', id);
});

// ───── Команды ─────
setupBroadcast(bot, DEVELOPER_IDS);

bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Добро пожаловать в Genesis War!');
});

bot.onText(/^\/status$/, (msg) => {
  const up = Math.floor(process.uptime());
  bot.getMe().then(me => {
    bot.sendMessage(msg.chat.id, `⏱ Uptime: ${up}s\n🤖 Бот: @${me.username}\n👤 Ваш ID: ${msg.chat.id}`);
  });
});

bot.onText(/^\/help$/, (msg) => {
  bot.sendMessage(msg.chat.id, `
📘 Команды:
/start — Приветствие
/status — Статус бота
/map — Переход к карте
/whoami — Ваши данные
/debug — Статус API и polling
/broadcast <тип> <текст> — Рассылка

Типы: tech, important, info, warn
`);
});

bot.onText(/^\/map$/, (msg) => {
  bot.sendMessage(msg.chat.id, '📍 Открыть карту мира:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗺️ Перейти к карте', url: MAP_URL }],
      ],
    },
  });
});

bot.onText(/^\/whoami$/, (msg) => {
  const { id, username, first_name } = msg.from;
  const role = DEVELOPER_IDS.includes(id) ? '🛡️ Developer' : '👤 User';
  bot.sendMessage(msg.chat.id, `
🔍 Информация:
ID: ${id}
Username: @${username || '–'}
Имя: ${first_name}
Роль: ${role}
  `);
});

bot.onText(/^\/debug$/, (msg) => {
  const up = Math.floor(process.uptime());
  bot.getMe().then(me => {
    bot.sendMessage(msg.chat.id, `
🔧 Debug info:
Polling: ✅
Bot: @${me.username}
Uptime: ${up}s
Your ID: ${msg.chat.id}
  `);
  });
});

console.log('✅ Genesis War Bot запущен');
