// ============================
// GENESIS_LAUNCHER.js (ESM) - Основной файл бота
// ============================
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
    // Общее количество пользователей
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalResult.rows[0].count, 10);
    
    // Активные за последние 24 часа
    const activeResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE created_at >= NOW() - INTERVAL '1 day'
    `);
    const activeUsers = parseInt(activeResult.rows[0].count, 10);
    
    // Активные за последнюю неделю
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
    // Проверка базы данных
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
    // Проверка API
    const apiStart = Date.now();
    const apiResponse = await fetch(`${API_URL}/health`);
    const apiTime = Date.now() - apiStart;
    const apiText = await apiResponse.text();
    
    if (apiResponse.ok) {
      results.api = { 
        status: '✅', 
        message: `API: OK (${apiTime}ms) - ${apiText}`
      };
    } else {
      results.api = { 
        status: '❌', 
        message: `API: ERROR ${apiResponse.status} - ${apiText}`
      };
    }
  } catch (error) {
    results.api = { 
      status: '❌', 
      message: `API: ERROR - ${error.message}`
    };
  }
  
  // Проверка бота
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
          { text: '📊 Статистика пользователей', callback_data: 'admin_stats' },
          { text: '🔍 Проверить связи', callback_data: 'admin_check' }
        ],
        [
          { text: '👥 Список пользователей', callback_data: 'admin_users' },
          { text: '🔄 Обновить', callback_data: 'admin_refresh' }
        ],
        [
          { text: '⬅️ Назад в меню', callback_data: 'back_to_menu' }
        ]
      ]
    }
  };
  
  const message = `
🛠 *Панель администратора*

Выберите действие:
  `;
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    ...keyboard 
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
  
  // Регистрируем пользователя
  await registerUser(userId, firstName, lastName, username, languageCode);
  
  // Если пользователь - администратор, показываем админ-панель
  if (isAdmin(userId)) {
    sendAdminPanel(chatId);
  } else {
    // Отправляем обычное меню
    sendMainMenu(chatId, userId);
  }
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
  
  // Проверяем права администратора
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав доступа к админ-панели.');
    return;
  }
  
  sendAdminPanel(chatId);
});

// Обработчик команды /users
bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Проверяем, является ли пользователь администратором
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
    // Всегда отвечаем на callback query
    await bot.answerCallbackQuery(query.id);
    
    if (data === 'get_code') {
      await sendAccessCode(chatId, userId);
    } else if (data === 'open_map') {
      bot.sendMessage(chatId, `🌐 Откройте карту по ссылке:\n${MAP_URL}`, {
        reply_markup: {
          inline_keyboard: [
            [{
              text: 'Перейти к карте',
              url: MAP_URL
            }]
          ]
        }
      });
    } else if (data === 'back_to_menu') {
      if (isAdmin(userId)) {
        sendAdminPanel(chatId);
      } else {
        sendMainMenu(chatId, userId);
      }
    }
    
    // Админ-команды
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
        
        // Редактируем сообщение вместо отправки нового
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
                { text: '⬅️ Назад', callback_data: 'admin_refresh' }
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
                { text: '⬅️ Назад', callback_data: 'admin_refresh' }
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
                { text: '⬅️ Назад', callback_data: 'admin_refresh' }
              ]
            ]
          }
        });
      }
      else if (data === 'admin_refresh') {
        // Просто обновляем админ-панель
        sendAdminPanel(chatId);
        // Удаляем старое сообщение
        bot.deleteMessage(chatId, messageId);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка обработки callback:', error);
    bot.answerCallbackQuery(query.id, { text: '❌ Произошла ошибка' });
  }
});

// -----------------------------
// Вспомогательные функции
// -----------------------------

// Отправка главного меню
function sendMainMenu(chatId, userId) {
  const keyboard = {
    reply_markup: {
      keyboard: [
        ['🔑 Получить код доступа', '🗺 Открыть карту']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  
  const message = `
🌍 Добро пожаловать в GENESIS WAR MAP!

Нажмите на кнопку ниже для получения кода доступа к карте.
  `;
  
  bot.sendMessage(chatId, message, keyboard);
}

// Отправка кода доступа
async function sendAccessCode(chatId, userId) {
  try {
    // Генерируем новый код
    const code = generateAccessCode();
    
    console.log(`🔐 Генерация кода для пользователя ${userId}: ${code}`);
    
    // Сохраняем код через API
    const response = await fetch(`${API_URL}/api/save-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code,
        userId
      })
    });
    
    if (!response.ok) {
      throw new Error('Не удалось сохранить код');
    }
    
    const result = await response.json();
    console.log('✅ Код сохранен в API:', result);
    
    // Отправляем код пользователю с HTML разметкой
    const message = `
🔑 <b>Ваш код доступа к карте:</b>

<code>${code}</code>

Код действителен 5 минут. Скопируйте его и введите на сайте.
    `;
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🔄 Получить новый код',
            callback_data: 'get_code'
          }],
          [{
            text: '🗺 Открыть карту',
            callback_data: 'open_map'
          }]
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Error generating code:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка при генерации кода. Попробуйте позже.');
  }
}

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
    // Загружаем пользователей
    await loadUsers();
    
    console.log('✅ Бот инициализирован');
    console.log(`👑 Администратор: ${ADMIN_ID || 'не задан'}`);
    console.log(`🌐 API URL: ${API_URL}`);
    console.log(`🗺 MAP URL: ${MAP_URL}`);
    
    // Проверяем связи при старте
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
