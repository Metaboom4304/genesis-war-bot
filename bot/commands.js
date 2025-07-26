const fs = require('fs');
const path = require('path');
const safeSend = require('../utils/safeSend');
const styles = require('./broadcastStyles');
const { getMockTile, formatTile } = require('./simulation');
const {
  toggleSimulationMode,
  getBroadcastText,
  clearBroadcastText,
  getBroadcastStyle,
  setBroadcastStyle,
  getSimulationMode
} = require('./state');

const DATA_DIR       = path.join(__dirname, '..', 'data');
const USERS_FILE     = path.join(DATA_DIR, 'users.json');
const CHANGELOG_FILE = path.join(DATA_DIR, 'changelog.json');
const ROADMAP_FILE   = path.join(DATA_DIR, 'roadmap.json');
const TILEMAP_FILE   = path.join(DATA_DIR, 'tileMap.json');

const DEVELOPER_IDS = (process.env.DEVELOPER_IDS || '')
  .split(',')
  .map(id => Number(id.trim()));
function isDev(chatId) {
  return DEVELOPER_IDS.includes(chatId);
}

// автоинициализация JSON
function ensureFile(filePath, defaultContent) { /* ... */ }
ensureFile(USERS_FILE,     { users: [] });
ensureFile(CHANGELOG_FILE, []);
ensureFile(ROADMAP_FILE,   []);
ensureFile(TILEMAP_FILE,   { tiles: [] });

// inline-кнопки
async function handleCallback(bot, query) {
  await bot.answerCallbackQuery(query.id);
  return safeSend(bot, query.message.chat.id, '⚠️ Эта кнопка пока неактивна.');
}

// changelog
function sendChangelog(bot, chatId) {
  try {
    const list = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf-8'))
      .map(i => `• *${i.version}*: ${i.description}`)
      .join('\n');
    safeSend(bot, chatId, list || '— пока пусто');
  } catch {
    safeSend(bot, chatId, '❌ Не удалось загрузить changelog.');
  }
}

// roadmap
function sendRoadmap(bot, chatId) {
  try {
    const list = JSON.parse(fs.readFileSync(ROADMAP_FILE, 'utf-8'))
      .map(i => `• *${i.title}*: ${i.notes}`)
      .join('\n');
    safeSend(bot, chatId, list || '— пока пусто');
  } catch {
    safeSend(bot, chatId, '❌ Не удалось загрузить roadmap.');
  }
}

// основной хендлер
async function handleText(bot, msg) {
  const chatId = msg.chat.id;
  const text   = msg.text.trim();

  if (text === '📦 Обновления') {
    return sendChangelog(bot, chatId);
  }
  if (text === '🗺 Дорожная карта') {
    return sendRoadmap(bot, chatId);
  }
  if (text === '🌐 Открыть карту') {
    return safeSend(bot, chatId, '🌐 Открыть карту онлайн:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 Перейти на сайт', url: 'https://metaboom4304.github.io/genesis-data/' }]
        ]
      }
    });
  }

  if (text === '🧪 Симуляция тайла') {
    if (isDev(chatId)) {
      const mode = toggleSimulationMode();
      return safeSend(bot, chatId,
        mode
          ? '🧪 Mock-режим включён — отправь ID тайла.'
          : '🔒 Mock-режим выключен.'
      );
    }
    return safeSend(bot, chatId, '🧪 Введите ID тайла (например, 1044).');
  }

  if (text === '📄 Логи карты') {
    if (!isDev(chatId)) return safeSend(bot, chatId, '⛔️ Нет доступа.');
    try {
      // диагностика...
      safeSend(bot, chatId, logText);
    } catch {
      safeSend(bot, chatId, '❌ Не удалось проверить тайлы.');
    }
    return;
  }

  if (text === '📂 Управление тайлами') {
    if (!isDev(chatId)) return safeSend(bot, chatId, '⛔️ Нет доступа.');
    return safeSend(bot, chatId,
      '📂 *Управление тайлами*\n' +
      '— /add_tile {JSON}\n' +
      '— /remove_tile {ID}\n' +
      '— /list_tiles'
    );
  }

  if (text === '🔧 DevPanel') {
    if (!isDev(chatId)) return safeSend(bot, chatId, '⛔️ Нет доступа.');
    return safeSend(bot, chatId,
      '🔧 *DevPanel*\n— Управляй режимами, проверяй тайлы и чекай логи 📄'
    );
  }

  if (text === '📢 Рассылка') {
    if (!isDev(chatId)) return safeSend(bot, chatId, '⛔️ Нет доступа.');
    return safeSend(bot, chatId, '✏️ Введите текст для рассылки:', {
      reply_markup: { force_reply: true }
    });
  }

  // mock-режим
  if (/^\d+$/.test(text) && getSimulationMode()) {
    const tile   = getMockTile(text);
    const output = formatTile(tile, text);
    return safeSend(bot, chatId, output);
  }

  return safeSend(bot, chatId, '🤔 Неизвестная команда.');
}

module.exports = { handleCallback, handleText };
const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../config.js');

function reloadConfig() {
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

function logMapAction(username, status) {
  const logEntry = `${new Date().toISOString()} — ${username} ${status ? 'включил' : 'отключил'} карту\n`;
  fs.appendFileSync(path.join(__dirname, '../logs.txt'), logEntry);
}

bot.command('maptoggle', (ctx) => {
  const config = reloadConfig();
  const status = config.mapEnabled ? '🟢 карта включена' : '🔴 карта отключена';
  ctx.reply(`Статус карты: ${status}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: config.mapEnabled ? '❌ Отключить карту' : '✅ Включить карту', callback_data: 'toggle_map' }]
      ]
    }
  });
});

bot.action('toggle_map', (ctx) => {
  const config = reloadConfig();
  config.mapEnabled = !config.mapEnabled;

  const newConfigText = `module.exports = ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(configPath, newConfigText);

  ctx.editMessageText(`Карта теперь ${config.mapEnabled ? '🟢 включена' : '🔴 отключена'}`);
  logMapAction(ctx.from.username, config.mapEnabled);
});
