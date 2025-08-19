// index.js - Веб-API для GENESIS WAR MAP
// Репозиторий: genesis-war-bot
import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
// ВАЖНО: Используем process.env.PORT, который предоставляет Render
const PORT = process.env.PORT || 3001;

// Конфигурация Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- УЛУЧШЕННЫЙ CORS Middleware ---
// Этот middleware должен идти ПЕРЕД app.use(express.json())
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://genesis-data.onrender.com',
    'https://web.telegram.org',
    'http://localhost:3000'
  ];

  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
// --- КОНЕЦ CORS ---

// Middleware для парсинга JSON
app.use(express.json({ limit: '10mb' }));

// --- Мидлвар для логирования запросов ---
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.ip} (Origin: ${req.headers.origin || 'N/A'})`);
  next();
});
// ---------------------------------------

// --- Эндпоинты API ---

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.status(200).json({ 
      status: 'OK', 
      service: 'genesis-map-api',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).json({ 
      status: 'ERROR', 
      service: 'genesis-map-api',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// --- Работа с пользователями ---
app.post('/api/users', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username } = req.body;
    
    if (!telegram_id) {
      return res.status(400).json({ error: 'telegram_id is required' });
    }

    const result = await pool.query(
      `INSERT INTO users (telegram_id, first_name, last_name, username)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         username = EXCLUDED.username,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [telegram_id, first_name, last_name, username]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка регистрации пользователя:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Работа с метками пользователей ---
app.post('/api/marks', async (req, res) => {
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ error: 'user_id, tile_id, and mark_type are required' });
    }

    await pool.query(
      `DELETE FROM user_marks 
       WHERE user_id = $1 AND tile_id = $2 AND mark_type = $3`,
      [user_id, tile_id, mark_type]
    );
    
    let result;
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
    console.error('Ошибка сохранения метки:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/marks/:user_id', async (req, res) => {
  try {
    const userId = req.params.user_id;
    
    if (!userId) {
       return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await pool.query(
      `SELECT tile_id, mark_type, comment, created_at FROM user_marks WHERE user_id = $1`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка загрузки меток:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Работа с кешем тайлов ---
app.get('/api/tiles-cache', async (req, res) => {
  try {
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
    console.error('Ошибка загрузки кеша:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.post('/api/tiles-cache', async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
       return res.status(400).json({ error: 'data is required' });
    }

    const result = await pool.query(
      `INSERT INTO tiles_cache (data) 
       VALUES ($1) 
       RETURNING data, last_updated`,
      [data]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка сохранения кеша:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Прокси для получения данных с основного сервера игры ---
app.get('/api/proxy/tile-info', async (req, res) => {
  try {
    console.log('Запрос данных с основного сервера игры...');
    const url = 'https://back.genesis-of-ages.space/manage/get_tile_info.php';
    const response = await fetch(url, {
      timeout: 15000
    });
    
    if (!response.ok) {
      throw new Error(`Remote server error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Получено данных: ${Object.keys(data).length} тайлов`);
    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(502).json({ 
      error: 'Proxy error', 
      details: error.message,
      timestamp: new Date().toISOString(),
      target: 'https://back.genesis-of-ages.space/manage/get_tile_info.php'
    });
  }
});

// --- Обработка 404 для API ---
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
});

// --- Обработка ошибок ---
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error', 
    details: error.message,
    timestamp: new Date().toISOString()
  });
});

// Экспорт для возможной интеграции или тестирования
let server;

function startAPIServer() {
    return new Promise((resolve) => {
        server = app.listen(PORT, '0.0.0.0', () => { // Явно указываем хост
          console.log(`🚀 Веб-API для карты запущен на порту ${PORT}`);
          console.log(`📊 База данных: ${process.env.DATABASE_URL ? 'Настроена' : 'Не настроена'}`);
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
