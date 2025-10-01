import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Pool } from 'pg';
// Supabase
import { createClient } from '@supabase/supabase-js';

// -----------------------------
// ENV проверка (убран API_URL)
// -----------------------------
const requiredEnv = ['TELEGRAM_TOKEN', 'DATABASE_URL', 'ADMIN_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`🔴 Missing ENV: ${key}`);
    process.exit(1);
  }
}

// Подключение к базе данных (для пользователей и меток)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // ← ОБЯЗАТЕЛЬНО для Supabase
  }
});

// -----------------------------
// Подключение к Supabase (для кодов доступа)
// -----------------------------
const supabase = createClient(
  'https://vbcnhpsavynwzopvdqcw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiY25ocHNhdnlud3pvcHZkcWN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxODM2OTMsImV4cCI6MjA3NDc1OTY5M30.84WBqv1cEpasCrxoqzNpC5FPhciRHphPGJxhFIcMCmE'
);

// -----------------------------
// Константы и пути
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const BOT_PORT      = process.env.BOT_PORT || process.env.PORT || 10001;
const MAP_URL       = process.env.MAP_URL || 'https://genesis-data.onrender.com';
const ADMIN_ID      = parseInt(process.env.ADMIN_ID) || null;

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = dirname(__filename);

// -----------------------------
// Express keep-alive
// -----------------------------
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'genesis-war-bot',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (_req, res) => res.send('🤖 GENESIS bot is alive!'));

const server = app.listen(BOT_PORT, '0.0.0.0', () => console.log(`🌍 Express (keep-alive) listening on port ${BOT_PORT}`));
setInterval(() => console.log('💓 Bot heartbeat – still alive'), 60_000);

// -----------------------------
// Telegram Bot
// -----------------------------
const bot = new TelegramBot(TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 60,
    }
  }
});

bot.getMe()
  .then(me => console.log(`✅ GENESIS bot active as @${me.username}`))
  .catch(console.error);

// -----------------------------
// Хранилище пользователей
// -----------------------------
const users = new Map();

// Загрузка пользователей из БД при старте
async function loadUsers() {
  try {
    const result = await pool.query('SELECT * FROM users');
    result.rows.forEach(user => {
      users.set(user.id.toString(), {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        language_code: user.language_code,
        created_at: user.created_at,
        registered: true
      });
    });
    console.log(`✅ Загружено ${users.size} пользователей`);
  } catch (error) {
    console.error('❌ Ошибка загрузки пользователей:', error);
  }
}

// Регистрация пользователя
async function registerUser(userId, firstName, lastName, username, languageCode) {
  try {
    await pool.query(`
      INSERT INTO users (id, first_name, last_name, username, language_code)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code
    `, [userId, firstName, lastName || null, username || null, languageCode || 'ru']);
    
    users.set(userId.toString(), {
      id: userId,
      first_name: firstName,
      last_name: lastName,
      username: username,
      language_code: languageCode,
      created_at: new Date(),
      registered: true
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Ошибка регистрации пользователя ${userId}:`, error);
    return false;
  }
}

// Генерация случайного кода
function generateAccessCode() {
  return Math.floor(100000 + Math.random() * 900000).toString().substring(0, 6);
}

// -----------------------------
// Админ-функции
// -----------------------------

// Проверка является ли пользователь администратором
function isAdmin(userId) {
  return ADMIN_ID && userId === ADMIN_ID;
}

// Получение статистики пользователей
async function getUsersStats() {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalResult.rows[0].count, 10);
    
    const activeResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE created_at >= NOW() - INTERVAL '1 day'
    `);
    const activeUsers = parseInt(activeResult.rows[0].count, 10);
    
    const weeklyResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    const weeklyUsers = parseInt(weeklyResult.rows[0].count, 10);
    
    return {
      total: totalUsers,
      active24h: activeUsers,
      active7d: weeklyUsers
    };
  } catch (error) {
    console.error('❌ Ошибка получения статистики пользователей:', error);
    return { total: 0, active24h: 0, active7d: 0 };
  }
}

// Проверка связи с БД и ботом (API больше не проверяется)
async function checkConnections() {
  const results = {
    database: { status: '❌', message: '' },
    api: { status: '✅', message: 'API: Эмуляция (OK)' }, // Эмуляция
    bot: { status: '❌', message: '' }
  };
  
  try {
    const dbStart = Date.now();
    const dbResult = await pool.query('SELECT 1 as test');
    const dbTime = Date.now() - dbStart;
    results.database = { 
      status: '✅', 
      message: `База данных: OK (${dbTime}ms)`
    };
  } catch (error) {
    results.database = { 
      status: '❌', 
      message: `База данных: ERROR - ${error.message}`
    };
  }
  
  try {
    const botInfo = await bot.getMe();
    results.bot = { 
      status: '✅', 
      message: `Бот: OK (@${botInfo.username})`
    };
  } catch (error) {
    results.bot = { 
      status: '❌', 
      message: `Бот: ERROR - ${error.message}`
    };
  }
  
  return results;
}

// Глобальный кеш для проверки связи бот–API (эмуляция)
let botApiHealthCache = {
  data: null,
  timestamp: 0
};
const BOT_API_HEALTH_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Эмуляция проверки связи (API больше не используется)
async function checkBotApiConnection() {
  const now = Date.now();
  if (botApiHealthCache.data && (now - botApiHealthCache.timestamp < BOT_API_HEALTH_CACHE_TTL)) {
    console.log('✅ Возвращаем кэшированный результат bot-API связи (из кеша)');
    return botApiHealthCache.data;
  }

  // Эмулируем успешный ответ
  const mockResponse = {
    status: 'ok',
    service: 'genesis-war-bot',
    database: 'connected',
    timestamp: new Date().toISOString(),
    cached: false
  };

  botApiHealthCache = {
    data: mockResponse,
    timestamp: now
  };
  
  return mockResponse;
}

// Получение списка пользователей
async function getUsersList(limit = 50) {
  try {
    const result = await pool.query(`
      SELECT id, first_name, last_name, username, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка получения списка пользователей:', error);
    return [];
  }
}

// Отправка админ-панели
function sendAdminPanel(chatId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 Статистика', callback_data: 'admin_stats' },
          { text: '🔍 Проверить связи', callback_data: 'admin_check' }
        ],
        [
          { text: '👥 Список пользователей', callback_data: 'admin_users' },
          { text: '🤖 Бот-API связь', callback_data: 'admin_bot_api' }
        ],
        [
          { text: '🔑 Получить код', callback_data: 'get_code' },
          { text: '🗺 Открыть карту', callback_data: 'open_map' }
        ],
        [
          { text: '🐛 Тест API', callback_data: 'test_api' },
          { text: '⬅️ Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
  
  const message = `🛠 *Панель администратора*\n\nВыберите действие:`;
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    ...keyboard 
  }).catch(error => {
    console.error('❌ Ошибка отправки админ-панели:', error);
  });
}

// -----------------------------
// Обработчики команд
// -----------------------------

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name || '';
  const username = msg.from.username || '';
  const languageCode = msg.from.language_code || 'ru';
  
  console.log(`🔄 Команда /start от пользователя ${userId} (@${username})`);
  
  await registerUser(userId, firstName, lastName, username, languageCode);
  
  sendMainMenu(chatId, userId);
});

// Обработчик команды /code
bot.onText(/\/code/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🔑 Команда /code от пользователя ${userId}`);
  
  sendAccessCode(chatId, userId);
});

// Обработчик команды /admin
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🛠 Команда /admin от пользователя ${userId}`);
  
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав доступа к админ-панели.');
    return;
  }
  
  sendAdminPanel(chatId);
});

// Обработчик команды /map
bot.onText(/\/map/, async (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, `🌐 Откройте карту по ссылке:\n${MAP_URL}`, {
    reply_markup: {
      inline_keyboard: [
        [{
          text: '🗺 Перейти к карте',
          url: MAP_URL
        }]
      ]
    }
  });
});

// Обработчик команды /users
bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав для просмотра статистики.');
    return;
  }
  
  try {
    const stats = await getUsersStats();
    
    let message = `📊 *Статистика пользователей:*\n\n`;
    message += `👥 Всего пользователей: ${stats.total}\n`;
    message += `✅ Активных за 24ч: ${stats.active24h}\n`;
    message += `📈 Активных за 7д: ${stats.active7d}\n\n`;
    message += `_Для обновления используйте /users_`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    bot.sendMessage(chatId, '❌ Ошибка получения статистики.');
  }
});

// Обработчик текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (text.startsWith('/')) return;
  
  console.log(`📨 Текстовое сообщение от ${userId}: ${text}`);
  
  if (text === '🔑 Получить код доступа') {
    sendAccessCode(chatId, userId);
  } else if (text === '🗺 Открыть карту') {
    bot.sendMessage(chatId, `🌐 Откройте карту по ссылке:\n${MAP_URL}`, {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🗺 Перейти к карте',
            url: MAP_URL
          }]
        ]
      }
    });
  } else if (text === '🛠 Админ-панель' && isAdmin(userId)) {
    sendAdminPanel(chatId);
  }
});

// -----------------------------
// Обработчик callback-запросов
// -----------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const messageId = query.message.message_id;
  const data = query.data;
  
  console.log(`🔄 Callback от пользователя ${userId}: ${data}`);
  
  try {
    await bot.answerCallbackQuery(query.id);
    
    if (data === 'get_code') {
      await sendAccessCode(chatId, userId);
    } else if (data === 'open_map') {
      bot.sendMessage(chatId, `🌐 Откройте карту по ссылке:\n${MAP_URL}`, {
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🗺 Перейти к карте',
              url: MAP_URL
            }]
          ]
        }
      });
    } else if (data === 'main_menu') {
      sendMainMenu(chatId, userId);
    } else if (data === 'test_api') {
      if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
      }
      
      // Эмуляция теста API
      bot.editMessageText(`🔧 *Тест API недоступен*\nВ новой архитектуре API не используется.`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⬅️ Назад', callback_data: 'main_menu' }
            ]
          ]
        }
      });
    }
    
    else if (data.startsWith('admin_')) {
      if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
      }
      
      if (data === 'admin_stats') {
        const stats = await getUsersStats();
        
        let message = `📊 *Статистика пользователей:*\n\n`;
        message += `👥 Всего пользователей: ${stats.total}\n`;
        message += `✅ Активных за 24ч: ${stats.active24h}\n`;
        message += `📈 Активных за 7д: ${stats.active7d}\n\n`;
        message += `_Данные обновлены: ${new Date().toLocaleString('ru-RU')}_`;
        
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Обновить', callback_data: 'admin_stats' },
                { text: '🔍 Проверить связи', callback_data: 'admin_check' }
              ],
              [
                { text: '⬅️ Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        });
      }
      else if (data === 'admin_check') {
        const connections = await checkConnections();
        
        let message = `🔍 *Проверка связей:*\n\n`;
        message += `${connections.database.status} ${connections.database.message}\n`;
        message += `${connections.api.status} ${connections.api.message}\n`;
        message += `${connections.bot.status} ${connections.bot.message}\n\n`;
        message += `_Проверено: ${new Date().toLocaleString('ru-RU')}_`;
        
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 Статистика', callback_data: 'admin_stats' },
                { text: '🔄 Проверить снова', callback_data: 'admin_check' }
              ],
              [
                { text: '⬅️ Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        });
      }
      else if (data === 'admin_users') {
        const usersList = await getUsersList(20);
        
        let message = `👥 *Последние 20 пользователей:*\n\n`;
        
        if (usersList.length === 0) {
          message += `Нет зарегистрированных пользователей.`;
        } else {
          usersList.forEach((user, index) => {
            const username = user.username ? `@${user.username}` : 'нет username';
            const date = new Date(user.created_at).toLocaleDateString('ru-RU');
            message += `${index + 1}. ${user.first_name} ${user.last_name || ''} (${username}) - ${date}\n`;
          });
        }
        
        message += `\n_Всего пользователей: ${usersList.length}_`;
        
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 Статистика', callback_data: 'admin_stats' },
                { text: '🔍 Проверить связи', callback_data: 'admin_check' }
              ],
              [
                { text: '🔄 Обновить список', callback_data: 'admin_users' },
                { text: '⬅️ Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        });
      }
      else if (data === 'admin_bot_api') {
        const connectionStatus = await checkBotApiConnection();
        
        let message = `🤖 *Проверка связи Бот-API:*\n\n`;
        message += `🕐 Время проверки: ${new Date().toLocaleString('ru-RU')}\n`;
        message += `📊 Статус: ✅ OK\n`;
        message += `🗄️ База данных: connected\n`;
        message += `⏱️ Ответ: эмуляция\n`;
        
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Проверить снова', callback_data: 'admin_bot_api' },
                { text: '🔍 Общая проверка', callback_data: 'admin_check' }
              ],
              [
                { text: '⬅️ Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        });
      }
    }
  } catch (error) {
    console.error('❌ Ошибка обработки callback:', error);
    try {
      await bot.answerCallbackQuery(query.id, { text: '❌ Произошла ошибка' });
    } catch (e) {
      console.error('❌ Ошибка при ответе на callback:', e);
    }
  }
});

// -----------------------------
// Вспомогательные функции
// -----------------------------

// Отправка главного меню
function sendMainMenu(chatId, userId) {
  const keyboardButtons = [
    ['🔑 Получить код доступа', '🗺 Открыть карту']
  ];
  
  if (isAdmin(userId)) {
    keyboardButtons.push(['🛠 Админ-панель']);
  }
  
  const keyboard = {
    reply_markup: {
      keyboard: keyboardButtons,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  
  let message = `🌍 Добро пожаловать в GENESIS WAR MAP!\n\n`;
  message += `Нажмите на кнопку ниже для получения кода доступа к карте.`;
  
  if (isAdmin(userId)) {
    message += `\n\n👑 Вы вошли как администратор.`;
  }
  
  bot.sendMessage(chatId, message, keyboard).catch(error => {
    console.error('❌ Ошибка отправки главного меню:', error);
  });
}

// Отправка кода доступа - НОВАЯ ВЕРСИЯ (напрямую в Supabase)
async function sendAccessCode(chatId, userId) {
  try {
    const code = generateAccessCode();
    console.log(`🔐 Генерация кода для пользователя ${userId}: ${code}`);

    // Сохраняем код напрямую в Supabase
    const { error } = await supabase
      .from('access_codes')
      .insert({
        code: code,
        user_id: userId
      });

    if (error) throw error;

    const message = `🔑 *Ваш код доступа к карте:*\n\n` +
                   `\`${code}\`\n\n` +
                   `*Код действителен 5 минут.*\n\n` +
                   `1. Скопируйте код выше\n` +
                   `2. Перейдите на сайт карты\n` +
                   `3. Введите код в поле ввода\n\n` +
                   `🌐 *Ссылка на карту:* ${MAP_URL}`;

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Получить новый код', callback_data: 'get_code' }],
          [{ text: '🗺 Открыть карту', url: MAP_URL }]
        ]
      }
    });

  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    let errorMessage = '❌ *Ошибка генерации кода*\nПопробуйте еще раз.';
    if (error.message.includes('429')) {
      errorMessage = '❌ *Слишком много запросов*\nПодождите 1–2 минуты и попробуйте снова.';
    }
    await bot.sendMessage(chatId, errorMessage, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Попробовать снова', callback_data: 'get_code' }]
        ]
      }
    });
    if (isAdmin(userId)) {
      await bot.sendMessage(chatId, `🔧 *Техническая информация:*\n\`${error.message}\``, {
        parse_mode: 'Markdown'
      });
    }
  }
}

// -----------------------------
// Обработка ошибок бота
// -----------------------------
bot.on('error', (error) => {
  console.error('❌ Ошибка Telegram Bot:', error);
});

bot.on('polling_error', (error) => {
  console.error('❌ Ошибка polling:', error);
  // Автоматический перезапуск через 10 секунд при ошибках polling
  setTimeout(() => {
    console.log('🔄 Restarting bot polling...');
    bot.startPolling().catch(err => {
      console.error('❌ Failed to restart polling:', err);
    });
  }, 10000);
});

// -----------------------------
// Обработка необработанных исключений
// -----------------------------
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// -----------------------------
// Graceful shutdown
// -----------------------------
async function cleanUp() {
  console.log('🛑 Received shutdown signal, stopping services…');
  try {
    await bot.stopPolling();
    console.log('✅ Bot polling stopped');
  } catch (err) {
    console.error('❌ Error stopping bot:', err);
  }
  
  try {
    server.close(() => {
      console.log('✅ Express server closed');
    });
  } catch (err) {
    console.error('❌ Error closing server:', err);
  }
  
  try {
    await pool.end();
    console.log('✅ Database pool closed');
  } catch (err) {
    console.error('❌ Error closing database pool:', err);
  }
  
  process.exit(0);
}

process.on('SIGINT', cleanUp);
process.on('SIGTERM', cleanUp);

// -----------------------------
// Инициализация
// -----------------------------
(async () => {
  try {
    // Проверка подключения к БД
    console.log('🔌 Testing database connection...');
    const dbTest = await pool.query('SELECT NOW() as time');
    console.log('✅ Database connection OK:', dbTest.rows[0].time);
    
    await loadUsers();
    
    console.log('✅ Bot initialized successfully');
    console.log(`👑 Admin: ${ADMIN_ID || 'not set'}`);
    console.log(`🗺 Map: ${MAP_URL}`);
    
  } catch (error) {
    console.error('❌ Ошибка инициализации бота:', error);
    process.exit(1);
  }
})();
