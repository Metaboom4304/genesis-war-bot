// index.js - API Сервис (genesis-map-api)
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import 'dotenv/config'; // Убедитесь, что dotenv/config импортирован

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

// Создаем таблицы, если они не существуют (на случай первого запуска)
async function initDatabase() {
  try {
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

    // Добавим недостающие столбцы, если их нет (на всякий случай)
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language_code TEXT;`);
    } catch (e) { console.log("Column language_code may already exist or error:", e.message); }
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;`);
    } catch (e) { console.log("Column is_premium may already exist or error:", e.message); }
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`);
    } catch (e) { console.log("Column updated_at may already exist or error:", e.message); }

    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// --- API Эндпоинты ---

// Регистрация пользователя в базе данных
app.post('/register', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language_code, is_premium } = req.body;

    if (!telegram_id || !first_name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: telegram_id and first_name are required' 
      });
    }

    const query = `
      INSERT INTO users (telegram_id, first_name, last_name, username, language_code, is_premium)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code,
        is_premium = EXCLUDED.is_premium,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      telegram_id, 
      first_name, 
      last_name || null, 
      username || null, 
      language_code || 'ru',
      is_premium || false
    ];
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

// Эндпоинт для получения информации о пользователе по ID
app.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Эндпоинт для уведомлений (пример)
app.post('/notify', async (req, res) => {
  try {
    const { user_id, tile_id, action, comment } = req.body;
    console.log(`Notification: User ${user_id} performed ${action} on tile ${tile_id} with comment: ${comment}`);
    // Здесь можно добавить логику обработки уведомления, например, запись в БД или отправку сообщения через бот
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

// --- Эндпоинты для данных карты ---
// Эти эндпоинты нужно реализовать в соответствии с логикой вашего приложения
// Примеры:

app.get('/api/marks/:userId', async (req, res) => {
    const userId = req.params.userId;
    // Логика получения меток для пользователя userId
    // Например, из таблицы user_marks
    try {
        // const result = await pool.query('SELECT * FROM user_marks WHERE user_id = $1', [userId]);
        // res.status(200).json(result.rows);
        // Пока возвращаем пустой массив или тестовые данные
        res.status(200).json([]); // Заглушка
    } catch (error) {
        console.error('Error fetching marks:', error);
        res.status(500).json({ error: 'Failed to fetch marks' });
    }
});

app.get('/api/tiles-cache', async (req, res) => {
    // Логика получения кэшированной информации о тайлах
    // Например, из таблицы tiles_caches
    try {
        // const result = await pool.query('SELECT * FROM tiles_caches');
        // res.status(200).json(result.rows);
        // Пока возвращаем пустой массив или тестовые данные
        res.status(200).json([]); // Заглушка
    } catch (error) {
        console.error('Error fetching tiles cache:', error);
        res.status(500).json({ error: 'Failed to fetch tiles cache' });
    }
});

app.get('/api/proxy/tile-info', async (req, res) => {
    // Логика проксирования запроса к внешнему источнику тайлов
    // или получения информации из локальной БД
    try {
        // const result = await pool.query('SELECT ... FROM ...');
        // res.status(200).json(result.rows);
        // Пока возвращаем пустой объект или тестовые данные
        res.status(200).json({}); // Заглушка
    } catch (error) {
        console.error('Error fetching proxy tile info:', error);
        res.status(500).json({ error: 'Failed to fetch proxy tile info' });
    }
});


// --- Запуск сервера ---

app.listen(port, async () => {
  console.log(`🚀 genesis-map-api server is running on port ${port}`);
  await initDatabase();
  await checkDatabaseConnection();
  console.log(`✅ genesis-map-api service started successfully`);
});

// Обработка ошибок базы данных
pool.on('error', (err) => {
  console.error('❌ Unexpected database error', err);
  process.exit(-1);
});

// Graceful shutdown для API
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down API gracefully');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down API gracefully');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

export default app; // Необязательно для запуска, но полезно если будет импортироваться
