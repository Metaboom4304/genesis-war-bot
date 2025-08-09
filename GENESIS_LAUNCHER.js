// GENESIS_LAUNCHER.js
// ESM-версия, безопасные логи, polling, базовые команды, совместимо с Render

import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { Octokit } from '@octokit/rest';

// -----------------------------
// 0) Безопасные утилиты логирования
// -----------------------------
const log = {
  info: (...args) => console.info('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.debug('[DEBUG]', ...args),
};

function maskToken(token) {
  if (!token) return 'MISSING';
  if (token.length <= 8) return '*****';
  return token.slice(0, 4) + '***' + token.slice(-4);
}

// -----------------------------
// 1) Проверка переменных окружения
// -----------------------------
log.info('🤍 Checking required environment variables…');

const {
  TELEGRAM_TOKEN,
  ADMIN_ID,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  PORT,
  NODE_ENV,
} = process.env;

const requiredEnv = ['TELEGRAM_TOKEN'];
const missing = requiredEnv.filter((k) => !process.env[k]);

if (missing.length) {
  missing.forEach((name) => log.error(`🔴 Missing env: ${name}`));
  throw new Error('Missing required environment variables.');
}

// Не логируем секреты в открытом виде
log.info(`🟢 TELEGRAM_TOKEN OK (${maskToken(TELEGRAM_TOKEN)})`);
if (ADMIN_ID) log.info('🟢 ADMIN_ID OK');
if (GITHUB_TOKEN) log.info('🟢 GITHUB_TOKEN OK');
if (GITHUB_OWNER) log.info('🟢 GITHUB_OWNER OK');
if (GITHUB_REPO) log.info('🟢 GITHUB_REPO OK');

// -----------------------------
// 2) Инициализация GitHub (опционально)
// -----------------------------
let octokit = null;
if (GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO) {
  octokit = new Octokit({ auth: GITHUB_TOKEN });
  log.info('🔗 Octokit initialized for GitHub integration');
} else {
  log.warn('ℹ️ GitHub integration not fully configured (optional).');
}

// -----------------------------
// 3) Express (Render-friendly)
// -----------------------------
const app = express();
const APP_PORT = Number(PORT) || 10000;

app.get('/', (_req, res) => {
  res.status(200).send('GENESIS WAR Bot is alive');
});

app.listen(APP_PORT, () => {
  log.info(`🌍 Express listening on port ${APP_PORT}`);
});

// -----------------------------
// 4) Telegram Bot (Polling)
// -----------------------------
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
  log.error('Polling error:', err?.message || err);
});

bot.getMe()
  .then((me) => {
    log.info(`✅ GENESIS active as @${me.username}`);
  })
  .catch((e) => log.error('getMe failed:', e?.message || e));

// Регистрируем команды в меню Telegram
(async () => {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Начать работу' },
      { command: 'info', description: 'Информация о боте' },
      { command: 'map', description: 'Показать карту (или ввести город)' },
    ]);
  } catch (e) {
    log.warn('setMyCommands failed:', e?.message || e);
  }
})();

// Удобная раскладка клавиатуры
function defaultKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🤖 Info' }, { text: '🗺 Map' }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

// -----------------------------
// 5) Команды
// -----------------------------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(
      chatId,
      'Добро пожаловать в GENESIS WAR Bot.\nКоманды:\n' +
        '• /info — информация\n' +
        '• /map [запрос] — карта/поиск\n\n' +
        'Также доступны кнопки ниже.',
      defaultKeyboard()
    );
  } catch (e) {
    log.error('Error in /start:', e?.message || e);
  }
});

bot.onText(/\/info/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const isAdmin = ADMIN_ID && String(msg.from?.id) === String(ADMIN_ID);
    const infoText = [
      '🤖 GENESIS WAR Bot',
      `ENV: ${NODE_ENV || 'production'}`,
      `Admin access: ${isAdmin ? 'yes' : 'no'}`,
      octokit ? 'GitHub: connected' : 'GitHub: not configured',
    ].join('\n');

    await bot.sendMessage(chatId, infoText, defaultKeyboard());
  } catch (e) {
    log.error('Error in /info:', e?.message || e);
  }
});

// Обработка /map и /map <что-то>
bot.onText(/\/map(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const args = match?.[1]?.trim() || '';
  log.info('Map command received', { args });

  try {
    if (!args) {
      await bot.sendMessage(
        chatId,
        'Укажи запрос после команды. Примеры:\n' +
          '• /map Berlin\n' +
          '• /map Tokyo',
        defaultKeyboard()
      );
      return;
    }

    // Здесь твоя бизнес-логика карты.
    // Пока отправим эхо-ответ:
    await bot.sendMessage(chatId, `🗺 Запрос на карту: ${args}`, defaultKeyboard());
  } catch (e) {
    log.error('Error in /map:', e?.message || e);
  }
});

// -----------------------------
// 6) Поддержка кнопок из клавиатуры
// -----------------------------
bot.on('message', async (msg) => {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Локальные кнопки
  if (text === '🤖 Info' || /^info$/i.test(text)) {
    return bot.emit('text', { ...msg, text: '/info' });
  }
  if (text === '🗺 Map' || /^map$/i.test(text)) {
    // Предложим формат использования
    try {
      await bot.sendMessage(
        chatId,
        'Использование: /map <город/запрос>\nНапример: /map Berlin',
        defaultKeyboard()
      );
    } catch (e) {
      log.error('Error in Map button response:', e?.message || e);
    }
    return;
  }
});

// -----------------------------
// 7) GitHub — пример использования (опционально)
// -----------------------------
async function exampleGitHubPing() {
  if (!octokit) return;
  try {
    // Пример запроса: получаем информацию о репозитории
    const { data } = await octokit.repos.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    log.info('GitHub repo ok:', {
      full_name: data.full_name,
      private: data.private,
      default_branch: data.default_branch,
    });
  } catch (e) {
    log.warn('GitHub check failed:', e?.message || e);
  }
}
exampleGitHubPing();

// -----------------------------
// 8) Глобальные ловушки ошибок
// -----------------------------
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err?.message || err);
});

// Финальный лог
log.info('🚀 TelegramBot instance created, polling started');
