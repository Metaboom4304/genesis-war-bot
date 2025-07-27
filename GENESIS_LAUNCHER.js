// ╔════════════════════════════════════════╗
// ║ 🚀 GENESIS_LAUNCHER — запуск Telegram ║
// ╚════════════════════════════════════════╝

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// ╔════════════════════════════════╗
// ║ ⚙️ Настройки и переменные ENV ║
// ╚════════════════════════════════╝
const TOKEN = process.env.TELEGRAM_TOKEN;
const botEnabledFlag = './memory/botEnabled.lock'; // ← флаг активности

let launched = false;

// ╔════════════════════════════════════════╗
// ║ 🛡️ Проверка состояния и запуск polling ║
// ╚════════════════════════════════════════╝
function isBotEnabled() {
  return fs.existsSync(botEnabledFlag);
}

function activateBotFlag() {
  fs.writeFileSync(botEnabledFlag, 'enabled');
}

function deactivateBotFlag() {
  if (fs.existsSync(botEnabledFlag)) fs.unlinkSync(botEnabledFlag);
}

async function launchBot() {
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
    console.log(`✅ GENESIS Бот активен как @${me.username}`);
    launched = true;
  });

  // ╔═══════════════════════════╗
  // ║ 💬 Обработка команд       ║
  // ╚═══════════════════════════╝
  bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, `📊 Статус: бот ${launched ? 'запущен' : 'остановлен'}\nАктивен: ${isBotEnabled()}`);
  });

  bot.onText(/\/poweroff/, (msg) => {
    deactivateBotFlag();
    bot.sendMessage(msg.chat.id, '🛑 Бот остановлен. polling завершён.');
    process.exit();
  });

  bot.onText(/\/poweron/, (msg) => {
    if (!isBotEnabled()) {
      activateBotFlag();
      bot.sendMessage(msg.chat.id, '✅ Бот снова включён. Перезапустите для polling.');
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

// ╔═════════════════════════════════════════════╗
// ║ 📂 Старт последовательности GENESIS_BOOT.1 ║
// ╚═════════════════════════════════════════════╝
if (!fs.existsSync('./memory')) fs.mkdirSync('./memory');
activateBotFlag();
launchBot();
