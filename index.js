// index.js - Веб-API для GENESIS WAR MAP
// Репозиторий: genesis-war-bot
import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3001;

// --- УЛУЧШЕННЫЙ CORS Middleware ---
const corsOptions = {
  origin: [
    'https://genesis-data.onrender.com',
    'https://web.telegram.org',
    'http://localhost:3000',
    'https://your-frontend-domain.onrender.com' // Добавьте ваш фронтенд-домен
  ],
  optionsSuccessStatus: 200,
  credentials: true
};

app.use(cors(corsOptions));
// --- КОНЕЦ CORS ---

// --- Middleware для парсинга JSON с увеличенным лимитом ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ---------------------------------------------------------

// --- Middleware для логирования запросов ---
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.ip} (Origin: ${req.headers.origin || 'N/A'})`);
  next();
});
// ---------------------------------------

// --- Конфигурация Neon PostgreSQL ---
// Правильная конфигурация для Render + Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Увеличиваем таймауты для Render
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20 // Ограничиваем количество соединений
});

// Проверка соединения с БД при запуске
pool.on('connect', () => {
  console.log('✅ Новое подключение к базе данных установлено');
});

pool.on('error', (err) => {
  console.error('❌ Неожиданная ошибка подключения к базе:', err);
  process.exit(-1); // Завершаем процесс при ошибке подключения
});

// Функция для проверки подключения к БД
async function checkDatabaseConnection() {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Подключение к базе данных успешно');
    return true;
  } catch (err) {
    console.error('❌ Ошибка подключения к базе:', err);
    return false;
  }
}
// ------------------------------------

// --- Эндпоинты API ---

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await checkDatabaseConnection();
    res.status(200).json({ 
      status: 'OK', 
      service: 'genesis-map-api',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'disconnected'
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).json({ 
      status: 'ERROR', 
      service: 'genesis-map-api',
      error: 'Service unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

// --- Работа с пользователями ---
// Эндпоинт для регистрации/обновления пользователя
app.post('/api/users/register', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language_code, is_premium } = req.body;
    
    // Проверка обязательных полей
    if (!telegram_id) {
       return res.status(400).json({ error: 'telegram_id is required' });
    }

    // Проверяем подключение к БД
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    // Попытка вставить пользователя или обновить информацию, если он уже существует
    const result = await pool.query(
      `INSERT INTO users (telegram_id, first_name, last_name, username, language_code, is_premium)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (telegram_id) 
       DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         username = EXCLUDED.username,
         language_code = EXCLUDED.language_code,
         is_premium = EXCLUDED.is_premium,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [telegram_id, first_name || null, last_name || null, username || null, language_code || 'ru', is_premium || false]
    );
    
    console.log(`✅ Пользователь зарегистрирован/обновлён: ${telegram_id}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка регистрации пользователя:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});
// -------------------------------

// --- Работа с метками пользователей ---
// Эндпоинт для сохранения/удаления метки пользователя
app.post('/api/marks', async (req, res) => {
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    // Проверка обязательных полей
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ error: 'user_id, tile_id, and mark_type are required' });
    }

    // Проверяем подключение к БД
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    // --- Автоматическая регистрация пользователя, если его нет ---
    const userCheck = await pool.query(
      'SELECT 1 FROM users WHERE telegram_id = $1',
      [user_id]
    );
    
    if (userCheck.rowCount === 0) {
        console.log(`ℹ️ Пользователь ${user_id} не найден, регистрируем...`);
        await pool.query(
          `INSERT INTO users (telegram_id, first_name, last_name, username)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (telegram_id) DO NOTHING`,
          [user_id, 'Unknown User', '', 'unknown']
        );
        console.log(`✅ Пользователь ${user_id} зарегистрирован для сохранения метки.`);
    }
    // ------------------------------------------------------------------------------------------

    // Удаление предыдущей метки такого же типа для этой плитки у этого пользователя
    await pool.query(
      `DELETE FROM user_marks 
       WHERE user_id = $1 AND tile_id = $2 AND mark_type = $3`,
      [user_id, tile_id, mark_type]
    );
    
    let result;
    // Сохранение новой метки (если не сброс)
    if (mark_type !== 'clear') {
      result = await pool.query(
        `INSERT INTO user_marks (user_id, tile_id, mark_type, comment)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [user_id, tile_id, mark_type, comment || null]
      );
      
      return res.status(201).json(result.rows[0]);
    }
    
    res.status(200).json({ message: 'Mark cleared' });
  } catch (error) {
    console.error('❌ Ошибка сохранения метки:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Эндпоинт для получения всех меток пользователя
app.get('/api/marks/:user_id', async (req, res) => {
  try {
    const userId = req.params.user_id;
    
    if (!userId) {
       return res.status(400).json({ error: 'user_id is required' });
    }

    // Проверяем подключение к БД
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const result = await pool.query(
      `SELECT tile_id, mark_type, comment, created_at FROM user_marks WHERE user_id = $1`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка загрузки меток:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});
// -----------------------------------

// --- Работа с кешем тайлов ---
// Эндпоинт для получения последнего кеша
app.get('/api/tiles-cache', async (req, res) => {
  try {
    // Проверяем подключение к БД
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const result = await pool.query(
      `SELECT data, last_updated FROM tiles_cache 
       ORDER BY last_updated DESC 
       LIMIT 1`
    );
    
    if (result.rows.length > 0) {
        res.json(result.rows[0]);
    } else {
        res.status(404).json({ error: 'Cache not found' });
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки кеша:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Эндпоинт для сохранения/обновления кеша
app.post('/api/tiles-cache', async (req, res) => {
  try {
    const { tilesResponse } = req.body;
    
    if (!tilesResponse) {
       return res.status(400).json({ error: 'tilesResponse is required' });
    }

    // Проверяем подключение к БД
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const result = await pool.query(
      `INSERT INTO tiles_cache (data) 
       VALUES ($1) 
       RETURNING data, last_updated`,
      [tilesResponse]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка сохранения кеша:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});
// --------------------------

// --- Прокси для получения данных с основного сервера игры ---
app.get('/api/proxy/tile-info', async (req, res) => {
  try {
    console.log('📥 Запрос данных с основного сервера игры...');
    
    // Увеличенный таймаут
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch('https://back.genesis-of-ages.space/manage/get_tile_info.php', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GenesisWarMap/1.0'
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Remote server error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`📥 Получено данных: ${Object.keys(data.tiles || {}).length} тайлов`);
    res.json(data);
  } catch (error) {
    console.error('❌ Proxy error:', error);
    
    // Если прокси не работает, попробуем вернуть данные из кеша
    try {
      const dbConnected = await checkDatabaseConnection();
      if (dbConnected) {
        const cacheResult = await pool.query(
          `SELECT data FROM tiles_cache ORDER BY last_updated DESC LIMIT 1`
        );
        
        if (cacheResult.rows.length > 0) {
          console.log('🔄 Используем кешированные данные');
          return res.json(cacheResult.rows[0].data);
        }
      }
    } catch (cacheError) {
      console.error('❌ Ошибка при получении кеша:', cacheError);
    }
    
    res.status(502).json({ 
      error: 'Proxy error', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
// -----------------------------------------------------------------

// --- Обработка 404 для API ---
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
});
// ----------------------------

// --- Обработка ошибок ---
app.use((error, req, res, next) => {
  console.error('🔥 Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error', 
    details: error.message,
    timestamp: new Date().toISOString()
  });
});
// ------------------------

// --- Экспорт для интеграции или тестирования ---
let server;

async function startAPIServer() {
  // Проверяем подключение к БД перед запуском сервера
  const dbConnected = await checkDatabaseConnection();
  if (!dbConnected) {
    console.error('❌ Не удалось подключиться к базе данных. Сервер не запущен.');
    process.exit(1);
  }
  
  return new Promise((resolve) => {
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Веб-API для карты запущен на порту ${PORT}`);
      console.log(`📊 База данных: ${dbConnected ? 'Подключена' : 'Не подключена'}`);
      console.log(`🌐 CORS origins: ${corsOptions.origin.join(', ')}`);
      resolve(server);
    });
  });
}

function stopAPIServer() {
  if (server) {
    server.close(() => {
      console.log('🛑 Веб-API сервер остановлен');
    });
  }
}

// Запуск сервера, если этот файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  startAPIServer().catch(console.error);
}

export { app, startAPIServer, stopAPIServer, pool };
