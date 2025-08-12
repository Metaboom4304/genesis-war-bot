import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { Octokit } from '@octokit/rest';
import { fileURLToPath } from 'url';

// -----------------------------
// 🛡️ ENV GUARD
// -----------------------------
const requiredEnv = ['TELEGRAM_TOKEN', 'ADMIN_ID', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
let envValid = true;
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`🔴 Missing ENV: ${key}`);
    envValid = false;
  } else {
    console.log(`🟢 ${key} OK`);
  }
}
if (!envValid) {
  console.error('⛔ Please set all ENV variables and restart.');
  process.exit(1);
}

// -----------------------------
// 📑 Configuration
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
// 🗂️ Paths
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const memoryPath = path.join(__dirname, 'memory');
const usersPath  = path.join(__dirname, 'users.json');
const lockPath   = path.join(memoryPath, 'botEnabled.lock');
const logsPath   = path.join(__dirname, 'logs.txt');

if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath, { recursive: true });
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath, '{}');
if (!fs.existsSync(lockPath))   fs.writeFileSync(lockPath, 'enabled');
if (!fs.existsSync(logsPath))   fs.writeFileSync(logsPath, '');

const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath, { recursive: true });

// -----------------------------
// 🧾 Logger
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
// 🔒 Flags & users
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
// 🌐 GitHub status via Octokit
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
// 📢 Broadcast all
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
// 🗂️ Reply keyboard menu
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
// 🤖 Telegram Bot init
// -----------------------------
activateBotFlag();
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('error',         err => console.error('💥 Telegram API error:', err));
bot.on('polling_error', err => console.error('🛑 Polling error:', err));
bot.on('webhook_error', err => console.error('🛑 Webhook error:', err));

bot.getMe()
  .then(me => console.log(`✅ GENESIS active as @${me.username}`))
  .catch(console.error);

// -----------------------------
// 🧠 Shared context for commands
// -----------------------------
const broadcastPending = new Set();
const disablePending   = new Set();

// Делаем хелперы доступными для команд, которые мы уже написали (без правки их кода)
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
// 📦 Автоподключение команд
// -----------------------------
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

const commands = new Map();

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

// 📥 Универсальный обработчик команд
bot.on('message', async (msg) => {
  const msgText = (msg.text || '').trim().toLowerCase();
  const chatId = msg.chat.id;
  const uid = String(msg.from.id);

  if (commands.has(msgText)) {
    try {
      await commands.get(msgText).execute(bot, msg);
    } catch (err) {
      console.error(`❌ Command ${msgText} failed:`, err);
      await bot.sendMessage(chatId, '❌ Ошибка при выполнении команды.');
    }
    return;
  }

  // остальные force-reply и /start остаются как есть
});

      console.log(`✅ Loaded command: ${command.name} (${file})`);
    })
    .catch(err => console.error(`❌ Failed to load ${file}:`, err));
}

// -----------------------------
// 🔤 Регулярка для /broadcast type text
// -----------------------------
import { setupBroadcastRegex } from './commands/broadcast_type.js';
setupBroadcastRegex(bot, [Number(ADMIN_ID)], { usersPath });

// -----------------------------
// ✏️ Force-reply handlers
// -----------------------------
bot.on('message', async (msg) => {
  const text   = msg.text || '';
  const chatId = msg.chat.id;
  const uid    = String(msg.from.id);

  // Pending: broadcast text
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text?.includes('Write broadcast text')
  ) {
    broadcastPending.delete(uid);
    await broadcastAll(bot, text);
    await bot.sendMessage(uid, '✅ Broadcast sent.');
    return sendReplyMenu(bot, chatId, uid);
  }

  // Pending: disable map confirm
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

  // Регистрация при первом заходе
  if (text === '/start') {
    registerUser(uid);
    return sendReplyMenu(bot, chatId, uid, '🚀 Welcome! You\'re registered.');
  }
});

// -----------------------------
// 🛑 Graceful shutdown
// -----------------------------
async function cleanUp() {
  console.log('🛑 Received shutdown signal, stopping bot…');
  try {
    await bot.stopPolling();
    console.log('✅ Polling stopped, exiting process.');
  } catch (err) {
    console.error('❌ Error during stopPolling:', err);
  }
  process.exit(0);
}
process.on('SIGINT', cleanUp);
process.on('SIGTERM', cleanUp);

// -----------------------------
// 🐶 Watchdog
// -----------------------------
setInterval(async () => {
  try {
    // node-telegram-bot-api может не иметь isPolling() как метода во всех версиях — делаем проверку безопасной
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
