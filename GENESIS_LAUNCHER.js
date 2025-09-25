import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Pool } from 'pg';
import fetch from 'node-fetch';

// -----------------------------
// ENV проверка
// -----------------------------
const requiredEnv = ['TELEGRAM_TOKEN', 'API_URL', 'DATABASE_URL'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`🔴 Missing ENV: ${key}`);
    process.exit(1);
  }
}

// -----------------------------
// Подключение к базе данных
// -----------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// -----------------------------
// Константы и пути
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const API_URL       = process.env.API_URL;
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
  polling: true,
  pollingOptions: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
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

// Проверка связи с API и БД
async function checkConnections() {
  const results = {
    database: { status: '❌', message: '' },
    api: { status: '❌', message: '' },
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
    const apiStart = Date.now();
    const apiResponse = await fetch(`${API_URL}/health`);
    const apiTime = Date.now() - apiStart;
    
    if (apiResponse.ok) {
      results.api = { 
        status: '✅', 
        message: `API: OK (${apiTime}ms)`
      };
    } else {
      results.api = { 
        status: '❌', 
        message: `API: ERROR ${apiResponse.status}`
      };
    }
  } catch (error) {
    results.api = { 
      status: '❌', 
      message: `API: ERROR - ${error.message}`
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

// Проверка связи между ботом и API
async function checkBotApiConnection() {
  try {
    console.log('🔍 Проверка связи бот-API...');
    const response = await fetch(`${API_URL}/api/bot-health`);
    const result = await response.json();
    console.log('✅ Статус связи бот-API:', result);
    return result;
  } catch (error) {
    console.error('❌ Ошибка проверки связи бот-API:', error);
    return { status: 'error', error: error.message };
  }
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

// Новая команда для тестирования API
bot.onText(/\/test_api/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🧪 Команда /test_api от пользователя ${userId}`);
  
  try {
    const response = await fetch(`${API_URL}/api/debug`);
    const data = await response.json();
    
    let message = `🔧 *Результат теста API:*\n\n`;
    message += `✅ Статус: ${data.status}\n`;
    message += `🕐 Время: ${new Date(data.timestamp).toLocaleString('ru-RU')}\n\n`;
    
    if (data.tables) {
      message += `📊 *Таблицы БД:*\n`;
      for (const [table, count] of Object.entries(data.tables)) {
        message += `• ${table}: ${count}\n`;
      }
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Ошибка теста API: ${error.message}`);
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
  } else if (text === '🐛 Тест API' && isAdmin(userId)) {
    try {
      const response = await fetch(`${API_URL}/api/debug`);
      const data = await response.json();
      
      let message = `🔧 *Результат теста API:*\n\n`;
      message += `✅ Статус: ${data.status}\n`;
      message += `🕐 Время: ${new Date(data.timestamp).toLocaleString('ru-RU')}\n\n`;
      
      if (data.tables) {
        message += `📊 *Таблицы БД:*\n`;
        for (const [table, count] of Object.entries(data.tables)) {
          message += `• ${table}: ${count}\n`;
        }
      }
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка теста API: ${error.message}`);
    }
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
      
      try {
        const response = await fetch(`${API_URL}/api/debug`);
        const data = await response.json();
        
        let message = `🔧 *Результат теста API:*\n\n`;
        message += `✅ Статус: ${data.status}\n`;
        message += `🕐 Время: ${new Date(data.timestamp).toLocaleString('ru-RU')}\n\n`;
        
        if (data.tables) {
          message += `📊 *Таблицы БД:*\n`;
          for (const [table, count] of Object.entries(data.tables)) {
            message += `• ${table}: ${count}\n`;
          }
        }
        
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Обновить', callback_data: 'test_api' },
                { text: '📊 Статистика', callback_data: 'admin_stats' }
              ],
              [
                { text: '⬅️ Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        });
      } catch (error) {
        bot.editMessageText(`❌ Ошибка теста API: ${error.message}`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Попробовать снова', callback_data: 'test_api' },
                { text: '⬅️ Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        });
      }
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
                { text: '👥 Список пользователей', callback_data: 'admin_users' },
                { text: '🐛 Тест API', callback_data: 'test_api' }
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
                { text: '👥 Список пользователей', callback_data: 'admin_users' },
                { text: '🐛 Тест API', callback_data: 'test_api' }
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
                { text: '🐛 Тест API', callback_data: 'test_api' }
              ],
              [
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
        message += `📊 Статус: ${connectionStatus.status === 'ok' ? '✅ OK' : '❌ ERROR'}\n`;
        
        if (connectionStatus.status === 'ok') {
          message += `🗄️ База данных: ${connectionStatus.database}\n`;
          message += `⏱️ Время ответа: ${new Date().toISOString()}\n`;
        } else {
          message += `🔧 Ошибка: ${connectionStatus.error}\n`;
        }
        
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
                { text: '🐛 Тест API', callback_data: 'test_api' },
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
    ['🔑 Получить код доступа', '🗺 Открыть карта']
  ];
  
  if (isAdmin(userId)) {
    keyboardButtons.push(['🛠 Админ-панель', '🐛 Тест API']);
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

// Отправка кода доступа - УЛУЧШЕННАЯ ВЕРСИЯ
async function sendAccessCode(chatId, userId) {
  let response;
  try {
    const code = generateAccessCode();
    
    console.log(`🔐 Генерация кода для пользователя ${userId}: ${code}`);
    console.log(`📡 Отправка запроса на: ${API_URL}/api/save-code`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    try {
      response = await fetch(`${API_URL}/api/save-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: code,
          userId: userId
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      console.log(`📡 Ответ API: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Ошибка API: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
      console.log('✅ Код сохранен в API:', result);
      
      const finalCode = result.newCode || code;
      
      const message = `🔑 *Ваш код доступа к карте:*\n\n` +
                     `\`${finalCode}\`\n\n` +
                     `*Код действителен 5 минут.*\n\n` +
                     `1. Скопируйте код выше\n` +
                     `2. Перейдите на сайт карты\n` +
                     `3. Введите код в поле ввода\n\n` +
                     `🌐 *Ссылка на карту:* ${MAP_URL}`;
      
      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🔄 Получить новый код',
              callback_data: 'get_code'
            }],
            [{
              text: '🗺 Открыть карту',
              url: MAP_URL
            }]
          ]
        }
      });
      
    } catch (fetchError) {
      clearTimeout(timeout);
      throw fetchError;
    }
    
  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    
    let errorMessage = '';
    
    if (error.name === 'AbortError') {
      errorMessage = '❌ *Таймаут соединения с сервером*\n\nСервер не ответил за 15 секунд. Попробуйте позже.';
    } else if (error.message.includes('Network') || error.message.includes('fetch')) {
      errorMessage = '❌ *Ошибка сети*\n\nНе удалось соединиться с сервером. Проверьте интернет-соединение.';
    } else if (error.message.includes('401') || error.message.includes('403')) {
      errorMessage = '❌ *Ошибка доступа*\n\nПроблемы с авторизацией на сервере.';
    } else if (error.message.includes('500')) {
      errorMessage = '❌ *Внутренняя ошибка сервера*\n\nСервер временно недоступен. Попробуйте через несколько минут.';
    } else {
      errorMessage = '❌ *Ошибка генерации кода*\n\nПопробуйте еще раз или обратитесь к администратору.';
    }
    
    await bot.sendMessage(chatId, errorMessage, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🔄 Попробовать снова',
            callback_data: 'get_code'
          }]
        ]
      }
    });
    
    if (isAdmin(userId)) {
      await bot.sendMessage(chatId, `🔧 *Техническая информация:*\n\n\`${error.message}\``, {
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
});

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
  process.exit(0);
}
process.on('SIGINT', cleanUp);
process.on('SIGTERM', cleanUp);

// -----------------------------
// Инициализация
// -----------------------------
(async () => {
  try {
    await loadUsers();
    
    console.log('✅ Бот инициализирован');
    console.log(`👑 Администратор: ${ADMIN_ID || 'не задан'}`);
    console.log(`🌐 API URL: ${API_URL}`);
    console.log(`🗺 MAP URL: ${MAP_URL}`);
    
    // Тестируем соединение с API при старте
    console.log('🔍 Проверка связи с API при старте...');
    try {
      const testResponse = await fetch(`${API_URL}/api/debug`);
      const testData = await testResponse.json();
      console.log('✅ Связь с API установлена:', testData.status);
    } catch (error) {
      console.error('❌ Ошибка связи с API:', error.message);
    }
    
    if (ADMIN_ID) {
      console.log('🔍 Проверка связей при старте...');
      const connections = await checkConnections();
      console.log('📊 Результаты проверки:');
      console.log(`   ${connections.database.status} ${connections.database.message}`);
      console.log(`   ${connections.api.status} ${connections.api.message}`);
      console.log(`   ${connections.bot.status} ${connections.bot.message}`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка инициализации бота:', error);
    process.exit(1);
  }
})();
