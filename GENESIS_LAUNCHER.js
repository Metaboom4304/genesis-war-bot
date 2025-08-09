'use strict';

console.log('🟡 GENESIS_LAUNCHER starting…');

require('dotenv').config();            // Load .env if present

// -----------------------------
// 📦 Imports
// -----------------------------
const fs          = require('fs');
const path        = require('path');
const http        = require('http');
const express     = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('@octokit/rest');

// -----------------------------
// 🛡️ ENV GUARD
// -----------------------------
const requiredEnv = [
  'TELEGRAM_TOKEN',
  'ADMIN_ID',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO'
];

let envValid = true;
console.log('\n🤍 Checking required environment variables…');

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
// 📑 Config constants
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const ADMIN_ID      = String(process.env.ADMIN_ID);
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const octokit       = new Octokit({ auth: GITHUB_TOKEN });
const PORT          = process.env.PORT || 3000;

// -----------------------------
// 🗂️ File system & lock flag
// -----------------------------
const memoryPath = path.join(__dirname, 'memory');
const usersPath  = path.join(__dirname, 'users.json');
const lockPath   = path.join(memoryPath, 'botEnabled.lock');

// Ensure directories and files
if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath);
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath, '{}');
if (!fs.existsSync(lockPath))   fs.writeFileSync(lockPath, 'enabled');

// Flag helpers
function isBotEnabled() {
  return fs.existsSync(lockPath);
}
function activateBotFlag() {
  fs.writeFileSync(lockPath, 'enabled');
}
function deactivateBotFlag() {
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

// -----------------------------
// 👥 User registration & stats
// -----------------------------
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
// 🌐 GitHub map-status.json via Octokit
// -----------------------------
async function fetchMapStatus() {
  const res = await octokit.rest.repos.getContent({
    owner: GITHUB_OWNER,
    repo:  GITHUB_REPO,
    path:  'map-status.json',
    ref:   GITHUB_BRANCH
  });
  const raw = Buffer.from(res.data.content, 'base64').toString();
  return {
    sha:    res.data.sha,
    status: JSON.parse(raw)
  };
}

async function updateMapStatus({ enabled, message, theme = 'auto', disableUntil }) {
  const { sha } = await fetchMapStatus();
  const newStatus = { enabled, message, theme, disableUntil };
  const content   = Buffer.from(JSON.stringify(newStatus, null, 2)).toString('base64');

  await octokit.rest.repos.createOrUpdateFileContents({
    owner:   GITHUB_OWNER,
    repo:    GITHUB_REPO,
    path:    'map-status.json',
    message: `🔄 Update map-status: enabled=${enabled}`,
    content,
    sha,
    branch:  GITHUB_BRANCH
  });
}

// -----------------------------
// 📢 Broadcast to all users
// -----------------------------
async function broadcastAll(bot, message) {
  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  } catch {}
  
  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, message);
    } catch (err) {
      console.error(`⚠️ Cannot send to ${uid}:`, err.response?.body || err);
      if (err.response?.statusCode === 403) {
        delete users[uid];
        console.log(`🗑️ Removed user ${uid}`);
      }
    }
  }

  try {
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  } catch {}
}

// -----------------------------
// 🗂️ Reply menu keyboard
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

  const keyboard = isAdmin
    ? baseButtons.concat(adminButtons)
    : baseButtons;

  bot.sendMessage(chatId, text, {
    reply_markup: { keyboard, resize_keyboard: true }
  }).catch(console.error);
}

// -----------------------------
// 🌐 Express keep-alive & heartbeat
// -----------------------------
const app = express();
app.get('/', (_req, res) => res.send('🤖 GENESIS bot is alive!'));
app.listen(PORT, () => console.log(`🌍 Express listening on port ${PORT}`));

setInterval(() => {
  console.log('💓 Bot heartbeat – still alive');
}, 60 * 1000);

// -----------------------------
// 🤖 Initialize Telegram Bot
// -----------------------------
activateBotFlag();

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('🚀 TelegramBot instance created, polling started');

// Error handlers
bot.on('error',         err => console.error('💥 Telegram API error:', err));
bot.on('polling_error', err => console.error('🛑 Polling error:', err));
bot.on('webhook_error', err => console.error('🛑 Webhook error:', err));

// Confirm bot identity
let launched = false;
bot.getMe()
  .then(me => {
    console.log(`✅ GENESIS active as @${me.username}`);
    launched = true;
  })
  .catch(console.error);

// -----------------------------
// ⚙️ Message & command handling
// -----------------------------
const broadcastPending = new Set();
const disablePending   = new Set();

bot.on('message', async msg => {
  const text   = msg.text || '';
  const chatId = msg.chat.id;
  const uid    = String(msg.from.id);

  console.log(`📨 [${chatId}] ${msg.from.username || uid}: ${text}`);

  // — Handle broadcast replies
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text.includes('Write broadcast text')
  ) {
    broadcastPending.delete(uid);
    await broadcastAll(bot, text);
    await bot.sendMessage(uid, '✅ Broadcast sent.');
    return sendReplyMenu(bot, chatId, uid);
  }

  // — Handle disable-map confirmation
  if (
    disablePending.has(uid) &&
    msg.reply_to_message?.text.includes('Confirm disabling map')
  ) {
    disablePending.delete(uid);
    const disableMsg = '🔒 Genesis temporarily disabled.\nWe\'ll be back soon with something big.';

    try {
      await updateMapStatus({
        enabled: false,
        message: disableMsg,
        theme:   'auto',
        disableUntil: new Date().toISOString()
      });
    } catch (err) {
      console.error('🛑 Disable error:', err);
      await bot.sendMessage(chatId, '❌ Failed to disable map.');
      return sendReplyMenu(bot, chatId, uid);
    }

    await broadcastAll(bot, disableMsg);
    await bot.sendMessage(chatId, '✅ Map disabled and everyone notified.');
    return sendReplyMenu(bot, chatId, uid);
  }

  // — Main menu & commands
  switch (text) {
    case '/start':
      registerUser(uid);
      return sendReplyMenu(bot, chatId, uid, '🚀 Welcome! You\'re registered.');

    case '/help':
      return sendReplyMenu(bot, chatId, uid,
        '📖 Commands:\n' +
        '/start — register\n' +
        '/status — bot status\n' +
        '/menu — show menu'
      );

    case '/status':
      return bot.sendMessage(chatId,
        `📊 Status:\n` +
        `- Launched: ${launched}\n` +
        `- Bot enabled: ${isBotEnabled()}\n` +
        `- Registered users: ${getUserCount()}`
      ).catch(console.error);

    case '/menu':
      return sendReplyMenu(bot, chatId, uid);

    case '📢 Broadcast':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid);
        return bot.sendMessage(chatId, '✏️ Write broadcast text:', {
          reply_markup: { force_reply: true }
        });
      }
      break;

    case '⚠️ Disable map':
      if (uid === ADMIN_ID) {
        disablePending.add(uid);
        return bot.sendMessage(chatId, '⚠️ Confirm disabling map:', {
          reply_markup: { force_reply: true }
        });
      }
      break;

    case '🔄 Enable map':
      if (uid === ADMIN_ID) {
        const enableMsg = '🔓 Genesis is back online!';
        try {
          await updateMapStatus({
            enabled: true,
            message: enableMsg,
            theme:   'auto',
            disableUntil: new Date().toISOString()
          });
          await bot.sendMessage(chatId, '✅ Map enabled.');
        } catch (err) {
          console.error('🛑 Enable error:', err);
          await bot.sendMessage(chatId, '❌ Failed to enable map.');
        }
        return sendReplyMenu(bot, chatId, uid);
      }
      break;

    case '🤖 Info':
      try {
        const { status } = await fetchMapStatus();
        await bot.sendMessage(chatId,
          `🧐 Info:\n` +
          `- enabled: ${status.enabled}\n` +
          `- message: ${status.message}`
        );
      } catch (err) {
        console.error('🛑 Info error:', err);
        await bot.sendMessage(chatId, '❌ Failed to fetch info.');
      }
      return sendReplyMenu(bot, chatId, uid);

    case '🛣 Roadmap':
      await bot.sendMessage(chatId,
        `🛣 Roadmap:\nhttps://github.com/${GITHUB_OWNER}/${GITHUB_REPO}` +
        `/blob/${GITHUB_BRANCH}/ROADMAP.md`
      );
      return sendReplyMenu(bot, chatId, uid);

    case '🌐 Links':
      await bot.sendMessage(chatId,
        '🌐 Links:\n' +
        `• GitHub: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}\n` +
        '• Support: https://t.me/your_support_chat'
      );
      return sendReplyMenu(bot, chatId, uid);

    case '🗺 Map':
      try {
        const { status } = await fetchMapStatus();
        await bot.sendMessage(chatId, status.message);
      } catch (err) {
        console.error('🛑 Map error:', err);
        await bot.sendMessage(chatId, '❌ Failed to fetch map.');
      }
      return sendReplyMenu(bot, chatId, uid);

    case '❓ Help':
      await bot.sendMessage(chatId,
        '❓ Help:\n– Use the menu buttons\n– /help for commands\n– Contact admin if needed'
      );
      return sendReplyMenu(bot, chatId, uid);

    case '📃 Logs':
      try {
        const logs = fs.readFileSync(path.join(__dirname, 'logs.txt'), 'utf8');
        await bot.sendMessage(chatId, `📃 Logs:\n${logs}`);
      } catch {
        await bot.sendMessage(chatId, '📃 Logs not available.');
      }
      return sendReplyMenu(bot, chatId, uid);

    case '👥 Add admin':
      return bot.sendMessage(chatId, '👥 Add admin not implemented.').then(() =>
        sendReplyMenu(bot, chatId, uid)
      );

    case '📑 Admins':
      await bot.sendMessage(chatId, `📑 Admins:\n• ${ADMIN_ID}`);
      return sendReplyMenu(bot, chatId, uid);

    default:
      return sendReplyMenu(bot, chatId, uid);
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
// 🐶 Watchdog: restart polling
// -----------------------------
setInterval(async () => {
  if (!bot.isPolling()) {
    console.warn('⚠️ Polling stopped unexpectedly, restarting…');
    try {
      await bot.startPolling();
      console.log('🔄 Polling restarted');
    } catch (err) {
      console.error('❌ Failed to restart polling:', err);
    }
  }
}, 30 * 1000);
