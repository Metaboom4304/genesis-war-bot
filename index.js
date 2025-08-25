import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Настройка подключения к базе данных Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Проверка подключения к базе данных
async function checkDatabaseConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    client.release();
    
    // Проверяем существование таблицы
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      );
    `);
    
    console.log('Users table exists:', tableCheck.rows[0].exists);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

// Создаем таблицы, если они не существуют
async function initDatabase() {
  try {
    // Таблица пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        language_code TEXT,
        is_premium BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Инициализация бота
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Логирование событий бота
bot.on('polling_error', (error) => {
  console.error('❌ Telegram polling error:', error);
});

bot.on('webhook_error', (error) => {
  console.error('❌ Telegram webhook error:', error);
});

console.log('✅ Telegram bot initialized');

// Регистрация пользователя в базе данных
app.post('/register', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language_code } = req.body;

    // Проверка обязательных полей
    if (!telegram_id || !first_name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: telegram_id and first_name are required' 
      });
    }

    const query = `
      INSERT INTO users (telegram_id, first_name, last_name, username, language_code)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [telegram_id, first_name, last_name || null, username || null, language_code || 'ru'];
    const result = await pool.query(query, values);

    res.status(200).json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('❌ Error registering user:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Database operation failed'
    });
  }
});

// Эндпоинт для получения всех пользователей (для рассылки)
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT telegram_id FROM users');
    const userIds = result.rows.map(row => row.telegram_id);
    res.status(200).json(userIds);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Эндпоинт для уведомлений
app.post('/notify', async (req, res) => {
  try {
    const { user_id, tile_id, action, comment } = req.body;
    console.log(`Notification: User ${user_id} performed ${action} on tile ${tile_id} with comment: ${comment}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error processing notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Эндпоинт для здоровья приложения
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'genesis-map-api'
  });
});

// Простой тестовый эндпоинт
app.get('/test', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'API is working',
    timestamp: new Date().toISOString()
  });
});

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  try {
    // Регистрируем пользователя в базе данных напрямую
    const query = `
      INSERT INTO users (telegram_id, first_name, last_name, username, language_code)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [user.id, user.first_name, user.last_name || '', user.username, user.language_code || 'ru'];
    const result = await pool.query(query, values);

    bot.sendMessage(chatId, 'Добро пожаловать в GENESIS WAR MAP! Используйте /help для списка команд.');
    console.log(`✅ User ${user.id} registered`);
  } catch (error) {
    console.error('❌ Error in /start command:', error);
    bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
});

// Команда /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `
Доступные команды:
/start - Запустить бота
/help - Показать помощь
/map - Получить ссылку на карту
/stats - Показать статистику
  `;
  bot.sendMessage(chatId, helpText);
});

// Команда /map
bot.onText(/\/map/, (msg) => {
  const chatId = msg.chat.id;
  const mapUrl = process.env.MAP_URL || 'https://genesis-data.onrender.com';
  bot.sendMessage(chatId, `Карта GENESIS WAR MAP: ${mapUrl}`);
});

// Команда /stats
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    const userCount = result.rows[0].count;
    
    bot.sendMessage(chatId, `Статистика бота:\n\n👥 Зарегистрированных пользователей: ${userCount}`);
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при получении статистики.');
  }
});

// Рассылка сообщений (только для администраторов)
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  // Проверяем, является ли пользователь администратором
  const isAdmin = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').includes(msg.from.id.toString()) : false;

  if (!isAdmin) {
    return bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
  }

  try {
    // Получаем пользователей напрямую из базы данных
    const result = await pool.query('SELECT telegram_id FROM users');
    const userIds = result.rows.map(row => row.telegram_id);

    let sent = 0;
    for (const uid of userIds) {
      try {
        await bot.sendMessage(uid, `📢 Рассылка от администратора:\n\n${message}`);
        sent++;
        // Задержка между сообщениями, чтобы избежать ограничений Telegram
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error(`❌ Cannot send to ${uid}:`, err.message);
      }
    }

    bot.sendMessage(chatId, `Рассылка завершена: отправлено ${sent}/${userIds.length}`);
  } catch (error) {
    console.error('❌ Error in broadcast:', error);
    bot.sendMessage(chatId, 'Ошибка при рассылке сообщения.');
  }
});

// Обработка callback-ов от inline-клавиатур
bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;

  // Обработка различных callback-ов
  if (data === 'show_map') {
    const mapUrl = process.env.MAP_URL || 'https://genesis-data.onrender.com';
    bot.sendMessage(msg.chat.id, `Карта GENESIS WAR MAP: ${mapUrl}`);
  }

  // Ответ на callback
  bot.answerCallbackQuery(callbackQuery.id);
});

// Запуск сервера
app.listen(port, async () => {
  console.log(`🚀 Server is running on port ${port}`);
  await initDatabase();
  await checkDatabaseConnection();
  console.log(`✅ Service genesis-map-api started successfully`);
});

// Обработка ошибок базы данных
pool.on('error', (err) => {
  console.error('❌ Unexpected database error', err);
  process.exit(-1);
});

export default app;
