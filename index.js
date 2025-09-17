// index.js - API для GENESIS WAR MAP
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import 'dotenv/config';
import { Octokit } from '@octokit/rest';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Конфигурация ---
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://genesis-data.onrender.com';
const API_URL = process.env.API_URL || 'https://genesis-map-api.onrender.com';

// --- Инициализация Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://*"],
      connectSrc: ["'self'", API_URL],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://*.t.me", "https://*.telegram.org"]
    }
  }
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));

// Ограничение количества запросов для защиты API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 1000, // максимум 1000 запросов с одного IP
  message: 'Слишком много запросов, попробуйте позже'
});
app.use('/api/', apiLimiter);

// Настройка CORS для разрешения запросов с фронтенда
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// --- Подключение к базе данных ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- Инициализация базы данных ---
async function initDatabase() {
  try {
    console.log('🔧 Инициализация структуры базы данных...');
    
    // Таблица пользователей
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
    
    // Таблица пользовательских меток
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_marks (
        user_id BIGINT NOT NULL,
        tile_id INTEGER NOT NULL,
        mark_type VARCHAR(20) NOT NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, tile_id, mark_type)
      );
      
      CREATE INDEX IF NOT EXISTS idx_user_marks_user_id ON user_marks(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_marks_tile_id ON user_marks(tile_id);
    `);
    
    // Таблица кэшированных данных тайлов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiles (
        tile_id INTEGER PRIMARY KEY,
        lat NUMERIC(10, 6) NOT NULL,
        lng NUMERIC(10, 6) NOT NULL,
        has_owner BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_tiles_tile_id ON tiles(tile_id);
    `);
    
    console.log('✅ Структура базы данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
    throw error;
  }
}

// --- Аутентификация ---
// Middleware для проверки аутентификации
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    req.user = user;
    next();
  });
}

// Эндпоинт для проверки токена
app.post('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// --- API Endpoints ---

// Регистрация пользователя
app.post('/api/users/register', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language_code } = req.body;

    // Базовая валидация
    if (!telegram_id || !first_name) {
      return res.status(400).json({ 
        error: 'Отсутствуют обязательные поля: telegram_id и first_name' 
      });
    }

    const query = `
      INSERT INTO users (id, first_name, last_name, username, language_code)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code
      RETURNING *;
    `;

    const values = [
      telegram_id, 
      first_name, 
      last_name || null, 
      username || null, 
      language_code || 'ru'
    ];
    
    const result = await pool.query(query, values);
    
    // Создаем JWT токен
    const token = jwt.sign(
      { 
        userId: result.rows[0].id,
        firstName: result.rows[0].first_name,
        lastName: result.rows[0].last_name,
        username: result.rows[0].username
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    
    res.status(200).json({ 
      token,
      user: {
        id: result.rows[0].id,
        first_name: result.rows[0].first_name,
        last_name: result.rows[0].last_name,
        username: result.rows[0].username,
        language_code: result.rows[0].language_code
      }
    });
  } catch (error) {
    console.error('Ошибка регистрации пользователя:', error);
    res.status(500).json({ 
      error: 'Ошибка базы данных',
      message: error.message
    });
  }
});

// Получение меток пользователя
app.get('/api/marks/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    // Проверка, что запрос делает сам пользователь
    if (userId !== req.user.userId) {
      return res.status(403).json({ 
        error: 'Доступ запрещен' 
      });
    }
    
    const result = await pool.query(
      `SELECT tile_id, mark_type, comment 
       FROM user_marks 
       WHERE user_id = $1`,
      [userId]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(`Ошибка получения меток для пользователя ${req.params.userId}:`, error);
    res.status(500).json({ 
      error: 'Не удалось получить метки',
      details: error.message 
    });
  }
});

// Сохранение метки
app.post('/api/marks', authenticateToken, async (req, res) => {
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    // Проверка, что пользователь может изменять только свои метки
    if (user_id !== req.user.userId) {
      return res.status(403).json({ 
        error: 'Доступ запрещен' 
      });
    }
    
    // Валидация
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ 
        error: 'Отсутствуют обязательные поля: user_id, tile_id, mark_type' 
       });
    }
    
    // Дополнительная валидация
    const VALID_MARK_TYPES = ['ally', 'enemy', 'favorite', 'clear'];
    if (!VALID_MARK_TYPES.includes(mark_type)) {
      return res.status(400).json({ 
        error: `Недопустимый тип метки. Допустимые: ${VALID_MARK_TYPES.join(', ')}` 
      });
    }

    let query, values;
    
    if (mark_type === 'clear') {
        // Удаление метки
        query = 'DELETE FROM user_marks WHERE user_id = $1 AND tile_id = $2';
        values = [user_id, tile_id];
        await pool.query(query, values);
        res.status(200).json({ 
          message: 'Метка удалена' 
        });
    } else {
        // Создание или обновление метки
        query = `
            INSERT INTO user_marks (user_id, tile_id, mark_type, comment)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, tile_id, mark_type)
            DO UPDATE SET 
              comment = EXCLUDED.comment
            RETURNING *;
        `;
        values = [user_id, tile_id, mark_type, comment || null];
        const result = await pool.query(query, values);
        res.status(200).json({ 
          mark: {
            tile_id: result.rows[0].tile_id,
            mark_type: result.rows[0].mark_type,
            comment: result.rows[0].comment
          }
        });
    }
  } catch (error) {
    console.error(`Ошибка сохранения метки для пользователя ${req.body.user_id} на тайле ${req.body.tile_id}:`, error);
    res.status(500).json({ 
      error: 'Не удалось сохранить метку', 
      details: error.message 
    });
  }
});

// Получение тайлов в пределах границ
app.get('/api/tiles/bounds', authenticateToken, async (req, res) => {
  try {
    const { west, south, east, north, limit = 1000, offset = 0 } = req.query;
    
    // Валидация и парсинг параметров
    const bounds = {
      west: parseFloat(west),
      south: parseFloat(south),
      east: parseFloat(east),
      north: parseFloat(north)
    };

    if (isNaN(bounds.west) || isNaN(bounds.south) || isNaN(bounds.east) || isNaN(bounds.north)) {
       return res.status(400).json({
         error: 'Некорректные параметры границ: west, south, east, north должны быть числами'
       });
    }

    const queryLimit = Math.min(parseInt(limit), 1000);
    const queryOffset = Math.max(parseInt(offset), 0);

    const query = `
      SELECT 
        tile_id,
        lat,
        lng,
        has_owner
      FROM tiles 
      WHERE 
        lng BETWEEN $1 AND $3 AND
        lat BETWEEN $2 AND $4
      LIMIT $5 OFFSET $6
    `;

    const result = await pool.query(query, [
      bounds.west, bounds.south, 
      bounds.east, bounds.north,
      queryLimit, queryOffset
    ]);

    // Строгая валидация данных
    const tiles = result.rows.map(row => ({
      id: row.tile_id,
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lng),
      has_owner: row.has_owner ? 'true' : 'false'
    }));

    // Подсчет общего количества для пагинации
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tiles 
      WHERE 
        lng BETWEEN $1 AND $3 AND
        lat BETWEEN $2 AND $4
    `, [
      bounds.west, bounds.south, 
      bounds.east, bounds.north
    ]);
    
    const totalCount = parseInt(countResult.rows[0].count, 10);

    res.json({
      tiles,
      count: tiles.length,
      total: totalCount,
      bounds,
      offset: queryOffset,
      limit: queryLimit,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Ошибка запроса тайлов по границам:', error);
    res.status(500).json({
      error: 'Не удалось получить тайлы',
      message: error.message
    });
  }
});

// --- Запуск сервера ---
app.listen(port, async () => {
  console.log(`🚀 Сервер API запущен на порту ${port}`);
  console.log(`🌐 CORS разрешён для: ${CORS_ORIGIN}`);
  
  try {
    // Инициализируем БД
    await initDatabase();
  } catch (error) {
    console.error('❌ Критическая ошибка инициализации:', error);
    // Даже при ошибке продолжаем работу
  }
});

export default app;
