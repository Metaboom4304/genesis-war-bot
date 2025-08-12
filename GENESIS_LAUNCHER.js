// -----------------------------
// 📦 Импорты и конфигурация
// -----------------------------
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { Octokit } from '@octokit/rest';
import { fileURLToPath } from 'url';
import { setupBroadcastRegex } from './commands/broadcast_type.js';

// -----------------------------
// 🛡️ Проверка ENV
// -----------------------------
const requiredEnv = ['TELEGRAM_TOKEN', 'ADMIN_ID', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`🔴 Missing ENV: ${key}`);
    process.exit(1);
  }
}

// -----------------------------
// 📑 Константы
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const ADMIN_ID      = String(process.env.ADMIN_ID);
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const PORT          = process.env.PORT || 3000;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ADMIN_ID;

// -----------------------------
// 🗂️ Пути
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const memoryPath = path.join(__dirname, 'memory');
const usersPath  = path.join(__dirname, 'users.json');
const lockPath   = path.join(memoryPath, 'botEnabled.lock');
const logsPath   = path.join(__dirname, 'logs.txt');
const commandsPath = path.join(__dirname, 'commands');
const pidPath    = path.join(memoryPath, 'genesis.lock');

// -----------------------------
// 🧷 Защита от двойного запуска
// -----------------------------
if (fs.existsSync(pidPath)) {
  const oldPid = fs.readFileSync(pidPath, 'utf8');
  try {
    process.kill(Number(oldPid), 0);
    console.error(`⛔ Genesis already running (PID ${oldPid})`);
    process.exit(1);
  } catch {
    fs.unlinkSync(pidPath);
    console.warn('⚠️ Сталый PID найден, но процесс неактивен — перезапуск');
  }
}
fs.writeFileSync(pidPath, String(process.pid));

// -----------------------------
// 📎 Инициализация директорий и файлов
// -----------------------------
for (const p of [memoryPath, commandsPath]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, '{}');
if (!fs.existsSync(lockPath)) fs.writeFileSync(lockPath, 'enabled');
if (!fs.existsSync(logsPath)) fs.writeFileSync(logsPath, '');

// -----------------------------
// 🧾 Логгер
// -----------------------------
function writeLog(level, message, meta = null) {
  const time = new Date().toISOString();
  const line = `${time} [${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`;
  try { fs.appendFileSync(logsPath, line); } catch {}
  const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  fn(line.trim());
}
const logger = {
  info:  (msg, meta) => writeLog('INFO', msg, meta),
  debug: (msg, meta) => writeLog('DEBUG', msg, meta),
  warn:  (msg, meta) => writeLog('WARN', msg, meta),
  error: (msg, meta) => writeLog('ERROR', msg, meta),
};

// -----------------------------
// 🔒 Флаги и пользователи
// -----------------------------
function isBotEnabled() { return fs.existsSync(lockPath); }
function activateBotFlag() { fs.writeFileSync(lockPath, 'enabled'); }
function deactivateBotFlag() { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }

function registerUser(userId) {
  const uid = String(userId);
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    if (!users[uid]) {
      users[uid] = { registered: true, ts: Date.now() };
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      console.log(`👤 Registered user: ${uid}`);
    }
  } catch (err) {
    console.error('❌ users.json write error:', err);
  }
}
function getUserCount() {
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    return Object.keys(users).length;
  } catch {
    return 0;
  }
}

// -----------------------------
// 🌐 GitHub статус
// -----------------------------
const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function fetchMapStatus() {
  const res = await octokit.rest.repos.getContent({
    owner: GITHUB_OWNER,
    repo:  GITHUB_REPO,
    path:  'map-status.json',
    ref:   GITHUB_BRANCH
  });
  const raw = Buffer.from(res.data.content, 'base64').toString('utf8');
  return { sha: res.data.sha, status: JSON.parse(raw) };
}

async function updateMapStatus({ enabled, message, theme = 'auto', disableUntil = null }) {
  const { sha, status: current } = await fetchMapStatus().catch(() => ({ sha: undefined, status: {} }));
  const newStatus = {
    ...current,
    enabled: Boolean(enabled),
    message: message ?? current?.message ?? '',
    theme: theme ?? current?.theme ?? 'auto',
    disableUntil
  };
  const contentBase = Buffer.from(JSON.stringify(newStatus, null, 2)).toString('base64');

  await octokit.rest.repos.createOrUpdateFileContents({
    owner:   GITHUB_OWNER,
    repo:    GITHUB_REPO,
    path:    'map-status.json',
    message: `🔄 Update map-status: enabled=${newStatus.enabled}`,
    content: contentBase,
    sha,
    branch:  GITHUB_BRANCH
  });
}

// -----------------------------
// 📢 Рассылка
// -----------------------------
async function broadcastAll(bot, message) {
  let users = {};
  try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8')); } catch {}
  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, message);
    } catch (err) {
      console.error(`⚠️ Cannot send to ${uid}:`, err.response?.body || err.message);
      if (err.response?.statusCode === 403) {
        delete users[uid];
        console.log(`🗑️ Removed user ${uid}`);
      }
    }
  }
  try { fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); } catch {}
}

// -----------------------------
// 🗂️ Меню
// -----------------------------
function sendReplyMenu(bot, chatId, uid, text = '📋 Menu:') {
  const isAdmin = String(uid) === ADMIN_ID;
  const baseButtons = [
    ['🤖 Info', '🛣 Roadmap'],
    ['🌐 Links', '🗺 Map'],
    ['❓ Help']
  ];
  const adminButtons = [
    ['📢 Broadcast', '📃 Logs'],
    ['⚠️ Disable map', '🔄 Enable map'],
    ['👥 Add admin', '📑 Admins']
  ];
  const keyboard = isAdmin ? [...baseButtons, ...adminButtons] : baseButtons;

  bot.sendMessage(chatId, text, {
    reply_markup: { keyboard, resize_keyboard: true }
  }).catch(console.error);
}

// -----------------------------
// 🌐 Express keep-alive
// -----------------------------
const app = express();
app.get('/', (_req, res) => res.send('🤖 GENESIS bot is alive!'));
app.listen(PORT, () => console.log(`🌍 Express listening on port ${PORT}`));
setInterval(() => console.log('💓 Bot heartbeat – still alive'), 60_000);

// -----------------------------
// 🤖 Telegram Bot
// -----------------------------
activateBotFlag();
const bot = new TelegramBot(TOKEN, { polling: true });

bot.getMe()
  .then(me => console.log(`✅ GENESIS active as @${me.username}`))
  .catch(console.error);

// -----------------------------
// 🧠 Контекст
// -----------------------------
const broadcastPending = new Set();
const disablePending   = new Set();

Object.assign(globalThis, {
  ADMIN_ID,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  sendReplyMenu,
  fetchMapStatus,
  updateMapStatus,
  broadcastAll,
  isBotEnabled,
  getUserCount,
  registerUser,
  logsPath,
  usersPath,
  broadcastPending,
  disablePending,
  logger
});

// -----------------------------
// 📦 Загрузка команд
// -----------------------------
const commands = new Map();
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const filepath = path.join(commandsPath, file);
  try {
        const { default: command } = await import(filepath);
    if (!command?.name || typeof command.execute !== 'function') {
      console.warn(`⚠️ Skip ${file}: invalid command shape`);
      continue;
    }
    commands.set(command.name.toLowerCase(), command);
    console.log(`✅ Loaded command: ${command.name} (${file})`);
  } catch (err) {
    console.error(`❌ Failed to load ${file}:`, err);
  }
}

// -----------------------------
// 🔤 Broadcast Regex
// -----------------------------
setupBroadcastRegex(bot, [Number(ADMIN_ID)], { usersPath });

// -----------------------------
// ✏️ Обработчик сообщений
// -----------------------------
bot.on('message', async (msg) => {
  const text   = (msg.text || '').trim();
  const chatId = msg.chat.id;
  const uid    = String(msg.from.id);

  // Broadcast reply
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text?.includes('Write broadcast text')
  ) {
    broadcastPending.delete(uid);
    await broadcastAll(bot, text);
    await bot.sendMessage(uid, '✅ Broadcast sent.');
    return sendReplyMenu(bot, chatId, uid);
  }

  // Disable map confirm
  if (
    disablePending.has(uid) &&
    msg.reply_to_message?.text?.includes('Confirm disabling map')
  ) {
    disablePending.delete(uid);
    const disableMsg = '🔒 Genesis temporarily disabled.\nWe’ll be back soon with something big.';
    try {
      await updateMapStatus({
        enabled: false,
        message: disableMsg,
        theme:   'auto',
        disableUntil: null
      });
      await broadcastAll(bot, disableMsg);
      await bot.sendMessage(chatId, '✅ Map disabled and everyone notified.');
    } catch (err) {
      console.error('🛑 Disable error:', err);
      await bot.sendMessage(chatId, '❌ Failed to disable map.');
    }
    return sendReplyMenu(bot, chatId, uid);
  }

  // Команда /start
  if (text === '/start') {
    registerUser(uid);
    return sendReplyMenu(bot, chatId, uid, '🚀 Welcome! You\'re registered.');
  }

  // Универсальный обработчик команд
  const cmdKey = text.toLowerCase();
  if (commands.has(cmdKey)) {
    try {
      await commands.get(cmdKey).execute(bot, msg);
    } catch (err) {
      console.error(`❌ Command ${cmdKey} failed:`, err);
      await bot.sendMessage(chatId, '❌ Ошибка при выполнении команды.');
    }
    return;
  }
});

// -----------------------------
// 🛑 Graceful shutdown
// -----------------------------
async function cleanUp() {
  console.log('🛑 Received shutdown signal, stopping bot…');
  try {
    await bot.stopPolling();
    console.log('✅ Polling stopped.');
  } catch (err) {
    console.error('❌ Error during stopPolling:', err);
  }
  try {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    console.log('🧹 PID lock removed.');
  } catch {}
  process.exit(0);
}
process.on('SIGINT', cleanUp);
process.on('SIGTERM', cleanUp);

// -----------------------------
// 🐶 Watchdog
// -----------------------------
setInterval(async () => {
  try {
    const isPolling = typeof bot.isPolling === 'function' ? bot.isPolling() : true;
    if (!isPolling) {
      console.warn('⚠️ Polling stopped unexpectedly, restarting…');
      await bot.startPolling();
      console.log('🔄 Polling restarted');
    }
  } catch (err) {
    console.error('❌ Failed to restart polling:', err);
  }
}, 30_000);
