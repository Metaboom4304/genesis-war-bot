// ╔══════════════════════════════════════════╗
// ║ 🧰 Инициализация системного окружения    ║
// ╚══════════════════════════════════════════╝
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

dotenv.config();

const memoryPath = path.join(__dirname, 'memory');
const usersPath = path.join(__dirname, 'users.json');
const envPath = path.join(__dirname, '.env');
const lockPath = path.join(memoryPath, 'botEnabled.lock');

// ┌──────────────────────────────────────────┐
// │ 📂 Проверка и создание окружения        │
// └──────────────────────────────────────────┘
if (!fs.existsSync(memoryPath)) {
  fs.mkdirSync(memoryPath);
  console.log('📁 memory/ создана');
}

if (!fs.existsSync(envPath)) {
  console.log('⚠️ Не найден .env — добавь TELEGRAM_TOKEN');
}

if (!fs.existsSync(usersPath)) {
  fs.writeFileSync(usersPath, JSON.stringify({}, null, 2));
  console.log('👥 users.json создан');
}

if (!fs.existsSync(lockPath)) {
  fs.writeFileSync(lockPath, 'enabled');
  console.log('🔓 botEnabled.lock активирован');
}

console.log('🟢 Старт инженерной консоли GENESIS');

// ╔══════════════════════════════════════════╗
// ║ 🚦 Статус и логика запуска Telegram Bot ║
// ╚══════════════════════════════════════════╝
const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  console.error('❌ TELEGRAM_TOKEN не найден в .env');
  process.exit();
}

let launched = false;
function isBotEnabled() {
  return fs.existsSync(lockPath);
}

// ╔═════════════════════════════════╗
// ║ 🤖 Запуск Telegram polling      ║
// ╚═════════════════════════════════╝
function launchBot() {
  if (launched) {
    console.log('⛔ Бот уже запущен. Повторный запуск запрещён.');
    return;
  }

  if (!isBotEnabled()) {
    console.log('🛑 Бот отключён — polling не запускается.');
    return;
  }

  const bot = new TelegramBot(TOKEN, { polling: true });

  bot.getMe().then((me) => {
    console.log(`✅ GENESIS активен как @${me.username}`);
    launched = true;
  });

  // ╔═════════════════════════════════╗
  // ║ 🎮 Обработка команд управления ║
  // ╚═════════════════════════════════╝
  bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, `📊 Статус:\n- Запущен: ${launched}\n- Активен: ${isBotEnabled()}\n- Юзеров: ${getUserCount()}`);
  });

  bot.onText(/\/poweroff/, (msg) => {
    deactivateBotFlag();
    bot.sendMessage(msg.chat.id, '🛑 Бот остановлен. polling завершён.');
    process.exit();
  });

  bot.onText(/\/poweron/, (msg) => {
    if (!isBotEnabled()) {
      activateBotFlag();
      bot.sendMessage(msg.chat.id, '✅ Бот включён. Перезапустите для polling.');
    } else {
      bot.sendMessage(msg.chat.id, '⚠️ Бот уже включён.');
    }
  });

  bot.onText(/\/restart/, (msg) => {
    deactivateBotFlag();
    activateBotFlag();
    bot.sendMessage(msg.chat.id, '🔄 Бот перезапускается...');
    process.exit();
  });

  bot.on('polling_error', (err) => {
    console.error('📡 Polling error:', err.message);
  });
}

// ╔══════════════════════════════════╗
// ║ 🧾 Работа с users.json           ║
// ╚══════════════════════════════════╝
function getUserCount() {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    const data = JSON.parse(raw);
    return Object.keys(data).length;
  } catch (e) {
    return 0;
  }
}

// ╔══════════════════════════════════╗
// ║ 🗝️ Работа с botEnabled.lock      ║
// ╚══════════════════════════════════╝
function activateBotFlag() {
  fs.writeFileSync(lockPath, 'enabled');
}

function deactivateBotFlag() {
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

// ╔══════════════════════════════════╗
// ║ 🚀 Инициализация GENESIS_BOOT.1 ║
// ╚══════════════════════════════════╝
activateBotFlag();
launchBot();
