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
// Инициализация структуры БД
// -----------------------------
async function initDatabase() {
  try {
    console.log('🔧 Проверка структуры базы данных...');
    
    // Создаем таблицу users если её нет
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT,
        username TEXT,
        language_code TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Проверим структуру таблицы
    const checkQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users';
    `;
    const checkResult = await pool.query(checkQuery);
    console.log('📊 Структура таблицы users:', checkResult.rows);
    
    console.log('✅ Структура базы данных проверена');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
  }
}

// Проверка подключения к БД
pool.connect()
  .then(client => {
    client.release();
    console.log('✅ Подключение к базе данных установлено');
    
    // Инициализируем структуру БД при подключении
    initDatabase();
  })
  .catch(err => {
    console.error('❌ Ошибка подключения к базе данных:', err);
  });

// -----------------------------
// Константы и пути
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const API_URL       = process.env.API_URL;
const BOT_PORT      = process.env.BOT_PORT || process.env.PORT || 10001;
const MAP_URL       = process.env.MAP_URL || 'https://genesis-data.onrender.com';
const ADMIN_ID      = process.env.ADMIN_ID;

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
// Используем webhook вместо polling для избежания конфликтов
const bot = new TelegramBot(TOKEN);

// Настройка webhook
async function setupWebhook() {
  try {
    // Получаем URL для webhook (используем Render URL)
    const webhookUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'genesis-war-bot.onrender.com'}/webhook`;
    
    // Устанавливаем webhook
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook установлен: ${webhookUrl}`);
    
    // Обработка webhook запросов
    app.post('/webhook', (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    
  } catch (error) {
    console.error('❌ Ошибка настройки webhook:', error);
    // Fallback на polling если webhook не работает
    startPolling();
  }
}

// Fallback на polling
function startPolling() {
  console.log('🔄 Запуск polling...');
  bot.startPolling({
    polling: {
      interval: 300,
      timeout: 10,
      limit: 100
    }
  });
  
  bot.getMe()
    .then(me => console.log(`✅ GENESIS bot active as @${me.username} (polling mode)`))
    .catch(console.error);
}

// -----------------------------
// Хранилище пользователей
// -----------------------------
const users = new Map();

// Загрузка пользователей из БД при старте
async function loadUsers() {
  try {
    const result = await pool.query('SELECT * FROM users');
    console.log(`📦 Загружаем пользователей: найдено ${result.rows.length} записей`);
    result.rows.forEach(user => {
      // Проверяем, что user и user.id существуют
      if (user && user.id !== undefined && user.id !== null) {
        users.set(user.id.toString(), {
          id: user.id,
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          username: user.username || '',
          language_code: user.language_code || 'ru',
          registered: true
        });
      } else {
        console.warn('⚠️ Пропущена запись пользователя без id:', user);
      }
    });
    console.log(`✅ Загружено ${users.size} пользователей`);
  } catch (error) {
    console.error('❌ Ошибка загрузки пользователей:', error);
  }
}

// Регистрация пользователя
async function registerUser(userId, firstName, lastName, username, languageCode) {
  try {
    console.log(`🔧 Попытка регистрации пользователя: ${userId}`);
    
    const result = await pool.query(`
      INSERT INTO users (id, first_name, last_name, username, language_code)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code
      RETURNING *
    `, [userId, firstName, lastName || null, username || null, languageCode || 'ru']);
    
    console.log(`✅ Пользователь ${userId} успешно зарегистрирован:`, result.rows[0]);
    
    users.set(userId.toString(), {
      id: userId,
      first_name: firstName,
      last_name: lastName,
      username: username,
      language_code: languageCode,
      registered: true
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Ошибка регистрации пользователя ${userId}:`, error);
    
    // Дополнительная диагностика
    if (error.code === '42703') { // Ошибка отсутствующего столбца
      console.error('🔍 Возможные причины:');
      console.error('1. Неправильная структура таблицы users');
      console.error('2. Несоответствие между запросом и структурой таблицы');
      
      // Попробуем получить структуру таблицы
      try {
        const tableInfo = await pool.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'users'
        `);
        console.error('📊 Текущая структура таблицы users:', tableInfo.rows);
      } catch (infoError) {
        console.error('❌ Не удалось получить информацию о таблице:', infoError);
      }
    }
    
    return false;
  }
}

// Генерация случайного кода
function generateAccessCode() {
  return Math.floor(100000 + Math.random() * 900000).toString().substring(0, 6);
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
  
  console.log(`👤 Пользователь ${userId} начал работу с ботом`);
  
  try {
    // Сначала попробуем просто добавить пользователя в память
    users.set(userId.toString(), {
      id: userId,
      first_name: firstName,
      last_name: lastName,
      username: username,
      language_code: languageCode,
      registered: false // Отмечаем как не зарегистрированного в БД
    });
    
    // Пытаемся зарегистрировать в БД, но не блокируем работу при ошибке
    const registered = await registerUser(userId, firstName, lastName, username, languageCode);
    
    if (!registered) {
      console.log(`⚠️ Пользователь ${userId} добавлен только в память (ошибка БД)`);
      bot.sendMessage(chatId, 'Добро пожаловать! БД временно недоступна, но вы можете пользоваться ботом.');
    }
    
    // Отправляем меню в любом случае
    sendMainMenu(chatId, userId);
    
  } catch (error) {
    console.error(`❌ Критическая ошибка в обработчике /start:`, error);
    bot.sendMessage(chatId, '❌ Произошла критическая ошибка. Попробуйте позже.');
  }
});

// Обработчик команды /code
bot.onText(/\/code/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🔑 Пользователь ${userId} запросил код доступа`);
  sendAccessCode(chatId, userId);
});

// Обработчик команды /users
bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Проверяем, является ли пользователь администратором
  if (ADMIN_ID && ADMIN_ID.toString() === userId.toString()) {
    const userCount = users.size;
    const activeUsers = await getActiveUsersCount();
    
    let message = `📊 Статистика пользователей:\n\n`;
    message += `👥 Всего пользователей: ${userCount}\n`;
    message += `✅ Активных сегодня: ${activeUsers}\n\n`;
    message += `Для обновления статистики используйте /users`;
    
    bot.sendMessage(chatId, message);
  }
});

// Обработчик текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;
  
  // Игнорируем команды (они обрабатываются отдельно)
  if (text && text.startsWith('/')) {
    return;
  }
  
  // Обработка текстовых кнопок
  if (text === '🔑 Получить код доступа') {
    sendAccessCode(chatId, userId);
  } else if (text === '🗺 Открыть карту') {
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
  }
});

// -----------------------------
// Обработчик callback-запросов
// -----------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const messageId = query.message.message_id;
  
  try {
    if (query.data === 'get_code') {
      await sendAccessCode(chatId, userId);
      bot.answerCallbackQuery(query.id, { text: 'Новый код сгенерирован' });
    } else if (query.data === 'open_map') {
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
      bot.answerCallbackQuery(query.id);
    }
  } catch (error) {
    console.error('❌ Ошибка обработки callback:', error);
    bot.answerCallbackQuery(query.id, { text: 'Произошла ошибка' });
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
    
    console.log(`🔐 Генерация кода ${code} для пользователя ${userId}`);
    
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
    
    // Отправляем код пользователю
    const message = `
🔑 Ваш код доступа к карте:

\`\`\`
${code}
\`\`\`

Код действителен 5 минут. Скопируйте его и введите на сайте.
    `;
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'MarkdownV2',
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
    
    console.log(`✅ Код ${code} отправлен пользователю ${userId}`);
    
  } catch (error) {
    console.error('❌ Error generating code:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка при генерации кода. Попробуйте позже.');
  }
}

// Получение количества активных пользователей
async function getActiveUsersCount() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE created_at >= NOW() - INTERVAL '1 day'
    `);
    
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return 0;
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
  
  try {
    await pool.end();
    console.log('✅ Database connection closed.');
  } catch (err) {
    console.error('❌ Error closing database connection:', err);
  }
  
  server.close(() => {
    console.log('✅ HTTP server closed.');
    process.exit(0);
  });
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
    
    // Настраиваем webhook или polling
    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      await setupWebhook();
    } else {
      startPolling();
    }
    
    console.log('✅ Бот инициализирован');
  } catch (error) {
    console.error('❌ Ошибка инициализации бота:', error);
    process.exit(1);
  }
})();
