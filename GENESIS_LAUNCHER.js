// ============================
// GENESIS_LAUNCHER.js (ESM) - Основной файл бота
// ============================
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express'; // Оставлен для keep-alive эндпоинта
import TelegramBot from 'node-telegram-bot-api';
import { Octokit } from '@octokit/rest';
import { fileURLToPath, pathToFileURL } from 'url';
import cors from 'cors';

// -----------------------------
// ENV проверка
// -----------------------------
const requiredEnv = ['TELEGRAM_TOKEN', 'ADMIN_ID', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`🔴 Missing ENV: ${key}`);
    process.exit(1);
  }
}

// -----------------------------
// Константы и пути
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const ADMIN_ID      = String(process.env.ADMIN_ID);
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const BOT_PORT      = process.env.BOT_PORT || process.env.PORT || 10000; // PORT для совместимости с Render

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const memoryPath   = path.join(__dirname, 'memory');
const usersPath    = path.join(__dirname, 'users.json');
const lockPath     = path.join(memoryPath, 'botEnabled.lock');
const logsPath     = path.join(__dirname, 'logs.txt');
const commandsPath = path.join(__dirname, 'commands');
const pidPath      = path.join(memoryPath, 'genesis.lock');
const aliasesPath  = path.join(__dirname, 'aliases.json');

// -----------------------------
// Защита от двойного запуска
// -----------------------------
if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath, { recursive: true });

if (fs.existsSync(pidPath)) {
  const oldPid = fs.readFileSync(pidPath, 'utf8');
  try {
    process.kill(Number(oldPid), 0);
    console.error(`⛔ Genesis already running (PID ${oldPid})`);
    process.exit(1);
  } catch {
    fs.unlinkSync(pidPath);
    console.warn('⚠️ Старый PID найден, процесс не активен — перезапуск');
  }
}
fs.writeFileSync(pidPath, String(process.pid));

// -----------------------------
// Подготовка директорий и файлов
// -----------------------------
for (const p of [commandsPath]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, '{}');
if (!fs.existsSync(lockPath)) fs.writeFileSync(lockPath, 'enabled');
if (!fs.existsSync(logsPath)) fs.writeFileSync(logsPath, '');

// -----------------------------
// Простой логгер в файл + консоль
// -----------------------------
function writeLog(level, message, meta = null) {
  const time = new Date().toISOString();
  const line = `${time} [${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`;
  try { fs.appendFileSync(logsPath, line); } catch {}
  const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  out(line.trim());
}
const logger = {
  info:  (m, meta) => writeLog('INFO',  m, meta),
  warn:  (m, meta) => writeLog('WARN',  m, meta),
  error: (m, meta) => writeLog('ERROR', m, meta),
  debug: (m, meta) => writeLog('DEBUG', m, meta)
};

// -----------------------------
// Флаги активности
// -----------------------------
function isBotEnabled() { return fs.existsSync(lockPath); }
function activateBotFlag() { fs.writeFileSync(lockPath, 'enabled'); }
function deactivateBotFlag() { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }

// -----------------------------
// Пользователи
// -----------------------------
function readUsers() {
  try { return JSON.parse(fs.readFileSync(usersPath, 'utf8')); }
  catch { return {}; }
}
function saveUsers(users) {
  try { fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); } catch {}
}
function registerUser(userId) {
  const uid = String(userId);
  const users = readUsers();
  if (!users[uid]) {
    users[uid] = { registered: true, ts: Date.now() };
    saveUsers(users);
    console.log(`👤 Registered user: ${uid}`);
  }
}
function getUserCount() {
  return Object.keys(readUsers()).length;
}

// -----------------------------
// GitHub: статус карты
// -----------------------------
const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function fetchMapStatus() {
  try {
    const res = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo:  GITHUB_REPO,
      path:  'map-status.json',
      ref:   GITHUB_BRANCH
    });
    const raw = Buffer.from(res.data.content, 'base64').toString('utf8');
    return { sha: res.data.sha, status: JSON.parse(raw) };
  } catch (err) {
    logger.warn('map-status.json not found, using defaults');
    return {
      sha: undefined,
      status: { enabled: true, message: '🗺 Карта доступна.', theme: 'auto', disableUntil: null }
    };
  }
}

async function updateMapStatus({ enabled, message, theme = 'auto', disableUntil = null }) {
  const { sha, status: current } = await fetchMapStatus().catch(() => ({ sha: undefined, status: {} }));
  const newStatus = {
    enabled: enabled ?? current?.enabled ?? true,
    message: message ?? current?.message ?? '',
    theme:   theme   ?? current?.theme   ?? 'auto',
    disableUntil
  };
  const contentBase64 = Buffer.from(JSON.stringify(newStatus, null, 2)).toString('base64');

  await octokit.rest.repos.createOrUpdateFileContents({
    owner:   GITHUB_OWNER,
    repo:    GITHUB_REPO,
    path:    'map-status.json',
    message: `🔄 Update map-status: enabled=${newStatus.enabled}`,
    content: contentBase64,
    sha,
    branch:  GITHUB_BRANCH
  });
  return newStatus;
}

// -----------------------------
// Рассылка по всем пользователям
// -----------------------------
async function broadcastAll(bot, message) {
  const users = readUsers();
  const ids = Object.keys(users);
  let sent = 0;
  for (const uid of ids) {
    try {
      await bot.sendMessage(uid, message);
      sent++;
    } catch (err) {
      console.error(`⚠️ Cannot send to ${uid}:`, err.response?.body || err.message);
      if (err.response?.statusCode === 403) {
        delete users[uid];
        console.log(`🗑️ Removed user ${uid}`);
      }
    }
  }
  saveUsers(users);
  console.log(`📤 Broadcast finished: ${sent}/${ids.length}`);
  return { sent, total: ids.length };
}

// -----------------------------
// Reply-меню
// -----------------------------
function sendReplyMenu(bot, chatId, uid, text = '📋 Меню:') {
  const isAdmin = String(uid) === ADMIN_ID;
  
  // КРИТИЧЕСКИ ВАЖНО: Используем WebApp кнопку вместо текстовой!
  const mapButton = [{
    text: "🗺 Открыть карту",
    web_app: { url: "https://genesis-data.onrender.com" }
  }];
  
  const baseButtons = [
    ['🤖 Инфо', '🛣 Дорожная карта'],
    ['🌐 Ссылки', '❓ Помощь'],
    mapButton
  ];

  const adminButtons = [
    ['📢 Рассылка', '📃 Логи'],
    ['⚠️ Отключить карту', '🔄 Включить карту'],
    ['👥 Добавить админа', '👥 Список пользователей']
  ];

  const keyboard = isAdmin ? [...baseButtons, ...adminButtons] : baseButtons;

  return bot.sendMessage(chatId, text, {
    reply_markup: { 
      keyboard, 
      resize_keyboard: true,
      one_time_keyboard: false
    }
  }).catch(console.error);
}

// -----------------------------
// Express keep-alive (если требуется Render)
// -----------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'genesis-war-bot',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (_req, res) => res.send('🤖 GENESIS bot is alive!'));

app.listen(BOT_PORT, '0.0.0.0', () => console.log(`🌍 Express (keep-alive) listening on port ${BOT_PORT}`));
setInterval(() => console.log('💓 Bot heartbeat – still alive'), 60_000);

// -----------------------------
// Telegram Bot - только POLLING
// -----------------------------
activateBotFlag();
const bot = new TelegramBot(TOKEN, { polling: true });

bot.getMe()
  .then(me => console.log(`✅ GENESIS bot active as @${me.username}`))
  .catch(console.error);

// -----------------------------
// Команды: загрузка
// -----------------------------
const commands = new Map();

try {
  const list = fs.readdirSync(commandsPath);
  console.log('📂 Файлы в папке commands:', list);
} catch (err) {
  console.error('❌ Не удалось прочитать папку commands:', err);
}

let commandFiles = [];
try {
  commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
} catch {
  commandFiles = [];
}

for (const file of commandFiles) {
  const filepath = path.join(commandsPath, file);
  try {
    const fileUrl = pathToFileURL(filepath).href;
    const { default: command } = await import(fileUrl);

    if (!command?.name || typeof command.execute !== 'function') {
      console.warn(`⚠️ Skip ${file}: invalid command shape`, command);
      continue;
    }
    const normName = command.name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    commands.set(normName, command);
    console.log(`✅ Loaded command: ${command.name} (${file}) => key: ${normName}`);
  } catch (err) {
    console.error(`❌ Failed to load ${file}:`, err);
  }
}

// -----------------------------
// Алиасы
// -----------------------------
let aliases = {};
try {
  aliases = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));
  console.log('🔗 Aliases loaded');
} catch {
  console.warn('⚠️ aliases.json not found or empty');
}

function resolveCommandKey(input) {
  if (!input) return '';
  const cleaned = input.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');

  for (const [key, variants] of Object.entries(aliases)) {
    if (cleaned === key || (Array.isArray(variants) && variants.includes(cleaned))) return key;
  }
  if (commands.has(cleaned)) return cleaned;
  for (const key of commands.keys()) {
    if (cleaned.startsWith(key)) return key;
  }
  return cleaned;
}

// -----------------------------
// Broadcast Regex (опционально)
// -----------------------------
let setupBroadcastRegex = null;
try {
  const mod = await import('./commands/broadcast_type.js');
  setupBroadcastRegex = mod.setupBroadcastRegex || null;
} catch {
  console.log('ℹ️ broadcast_type.js not found — skipping regex handler');
}

if (typeof setupBroadcastRegex === 'function') {
  try {
    setupBroadcastRegex(bot, [Number(ADMIN_ID)], { usersPath });
    console.log('📢 Broadcast regex handler set up');
  } catch (err) {
    console.warn('⚠️ setupBroadcastRegex failed:', err.message);
  }
} else {
  console.log('ℹ️ setupBroadcastRegex not available — пропускаем');
}

// -----------------------------
// Глобалы для совместимости с командами
// -----------------------------
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
  logger // Добавлен logger
});

// -----------------------------
// Обработчик сообщений
// -----------------------------
const broadcastPending = new Set();
const disablePending   = new Set();

// Добавляем в глобалы для команд
Object.assign(globalThis, {
  broadcastPending,
  disablePending
});

bot.on('message', async (msg) => {
  const text   = (msg.text || '').trim();
  const chatId = msg.chat.id;
  const uid    = String(msg.from.id);

  const cmdKey = resolveCommandKey(text);

  console.log('RAW TEXT:', text);
  console.log('CMD KEY:', cmdKey);
  console.log('ALL COMMANDS:', Array.from(commands.keys()));

  // Обработка ожидаемых ответов рассылки
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text?.includes('Write broadcast text')
  ) {
    broadcastPending.delete(uid);
    await broadcastAll(bot, text);
    await bot.sendMessage(uid, '✅ Рассылка отправлена.');
    return sendReplyMenu(bot, chatId, uid);
  }

  // Подтверждение отключения карты
  if (
    disablePending.has(uid) &&
    msg.reply_to_message?.text?.includes('Confirm disabling map')
  ) {
    disablePending.delete(uid);
    const disableMsg = '🔒 Genesis временно отключен.\nМы скоро вернемся с чем-то большим.';
    try {
      await updateMapStatus({
        enabled: false,
        message: disableMsg,
        theme:   'auto',
        disableUntil: null
      });
      await broadcastAll(bot, disableMsg);
      await bot.sendMessage(chatId, '✅ Карта отключена и все уведомлены.');
    } catch (err) {
      console.error('🛑 Ошибка отключения:', err);
      await bot.sendMessage(chatId, '❌ Не удалось отключить карту.');
    }
    return sendReplyMenu(bot, chatId, uid);
  }

  // /start
  if (cmdKey === 'start' || text === '/start') {
    registerUser(uid);
    return sendReplyMenu(bot, chatId, uid, '🚀 Добро пожаловать! Вы зарегистрированы.');
  }

  // --- Обработка новой кнопки "Список пользователей" ---
  if (text === '👥 Список пользователей' && String(uid) === ADMIN_ID) {
    const users = readUsers();
    const userList = Object.keys(users);
    if (userList.length === 0) {
        return bot.sendMessage(chatId, '📭 Список пользователей пуст.');
    }
    let message = `👥 Зарегистрированные пользователи (${userList.length}):\n`;
    const maxUsersToShow = 50;
    const usersToShow = userList.slice(0, maxUsersToShow);
    message += usersToShow.map(id => `ID: ${id}`).join('\n');
    if (userList.length > maxUsersToShow) {
        message += `\n... и ещё ${userList.length - maxUsersToShow} пользователей.`;
    }
    return bot.sendMessage(chatId, message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Обновить список', callback_data: 'refresh_users' }]
            ]
        }
    });
  }
  // -----------------------------------------------------

  // Универсальный запуск команды
  if (commands.has(cmdKey)) {
    try {
      await commands.get(cmdKey).execute(bot, msg);
    } catch (err) {
      console.error(`❌ Command ${cmdKey} failed:`, err);
      await bot.sendMessage(chatId, '❌ Ошибка при выполнении команды.');
    }
    return;
  }

  // Если команда не найдена
  // await bot.sendMessage(chatId, 'ℹ️ Команда не распознана. Нажмите кнопку в меню ниже.');
  // return sendReplyMenu(bot, chatId, uid);
});

// --- Обработка inline-кнопок ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const uid = String(query.from.id);
    const data = query.data;

    if (data === 'refresh_users' && uid === ADMIN_ID) {
        const users = readUsers();
        const userList = Object.keys(users);
        let message = `👥 Зарегистрированные пользователи (${userList.length}):\n`;
        const maxUsersToShow = 50;
        const usersToShow = userList.slice(0, maxUsersToShow);
        message += usersToShow.map(id => `ID: ${id}`).join('\n');
        if (userList.length > maxUsersToShow) {
            message += `\n... и ещё ${userList.length - maxUsersToShow} пользователей.`;
        }
        try {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Обновить список', callback_data: 'refresh_users' }]
                    ]
                }
            });
        } catch (err) {
            if (err.response?.body?.error_code !== 400) {
                 console.error('Ошибка редактирования сообщения:', err);
            }
        }
        await bot.answerCallbackQuery(query.id);
    }
    // Другие обработчики callback_data из команд
});
// -------------------------------------------------------------------------

// -----------------------------
// Graceful shutdown
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
// Watchdog перезапуска polling (по желанию)
// -----------------------------
// setInterval(async () => {
//   try {
//     // node-telegram-bot-api не предоставляет isPolling() напрямую
//     // Этот watchdog может быть не нужен или требует другой реализации
//   } catch (err) {
//     console.error('❌ Failed to check/restart polling:', err);
//   }
// }, 30_000);
