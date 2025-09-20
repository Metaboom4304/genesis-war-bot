// index.js - API для GENESIS WAR MAP
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import 'dotenv/config';
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
const CODE_LIFETIME = 5 * 60 * 1000; // 5 минут
const CODE_LENGTH = 6;

// --- Инициализация Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "", "https://*"],
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
    
    // Таблица кодов доступа
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        code VARCHAR(6) PRIMARY KEY,
        user_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        used BOOLEAN DEFAULT false
      );
      
      CREATE INDEX IF NOT EXISTS idx_access_codes_created ON access_codes(created_at);
    `);
    
    // Таблица токенов доступа
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_tokens (
        token VARCHAR(15) PRIMARY KEY,
        user_id BIGINT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_access_tokens_expires ON access_tokens(expires_at);
    `);
    
    console.log('✅ Структура базы данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
    throw error;
  }
}

// --- Очистка старых данных ---
async function cleanupOldCodes() {
  try {
    const cutoffTime = new Date(Date.now() - CODE_LIFETIME);
    await pool.query(`
      DELETE FROM access_codes WHERE created_at < $1
    `, [cutoffTime]);
    
    console.log('🧹 Старые коды очищены');
  } catch (error) {
    console.error('❌ Ошибка очистки старых кодов:', error);
  }
}

async function cleanupOldTokens() {
  try {
    const cutoffTime = new Date();
    await pool.query(`
      DELETE FROM access_tokens WHERE expires_at < $1
    `, [cutoffTime]);
    
    console.log('🧹 Старые токены очищены');
  } catch (error) {
    console.error('❌ Ошибка очистки старых токенов:', error);
  }
}

// --- Инициализация периодической очистки ---
cleanupOldCodes();
cleanupOldTokens();

setInterval(cleanupOldCodes, 10 * 60 * 1000); // Каждые 10 минут
setInterval(cleanupOldTokens, 30 * 60 * 1000); // Каждые 30 минут

// --- Функции ---
// Генерация случайного кода
function generateAccessCode() {
  return Math.floor(100000 + Math.random() * 900000).toString().substring(0, CODE_LENGTH);
}

// --- API Endpoints ---
// Эндпоинт для сохранения кода (вызывается ботом)
app.post('/api/save-code', async (req, res) => {
  const { code, userId } = req.body;
  
  if (!code || !userId) {
    return res.status(400).json({ error: 'Отсутствуют обязательные параметры' });
  }
  
  try {
    // Сохраняем код в БД
    await pool.query(`
      INSERT INTO access_codes (code, user_id)
      VALUES ($1, $2)
      ON CONFLICT (code) 
      DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        created_at = NOW(),
        used = false
    `, [code, userId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка сохранения кода:', error);
    res.status(500).json({ error: 'Не удалось сохранить код' });
  }
});

// Эндпоинт для проверки кода (вызывается фронтендом)
app.post('/api/verify-code', async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Код не указан' });
  }
  
  try {
    // Проверяем код в БД
    const result = await pool.query(`
      SELECT * FROM access_codes 
      WHERE code = $1
    `, [code]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Код не найден' });
    }
    
    const accessCode = result.rows[0];
    const now = new Date();
    const codeAge = now - new Date(accessCode.created_at);
    
    // Проверяем срок действия
    if (codeAge > CODE_LIFETIME) {
      await pool.query(`DELETE FROM access_codes WHERE code = $1`, [code]);
      return res.status(401).json({ error: 'Код устарел' });
    }
    
    // Проверяем, использован ли код
    if (accessCode.used) {
      return res.status(401).json({ error: 'Код уже использован' });
    }
    
    // Помечаем код как использованный
    await pool.query(`
      UPDATE access_codes 
      SET used = true 
      WHERE code = $1
    `, [code]);
    
    // Генерируем временный токен доступа (действителен 1 час)
    const accessToken = Math.random().toString(36).substr(2, 15);
    
    // Сохраняем токен в БД
    await pool.query(`
      INSERT INTO access_tokens (token, user_id, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (token) 
      DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        expires_at = EXCLUDED.expires_at
    `, [accessToken, accessCode.user_id, new Date(Date.now() + 60 * 60 * 1000)]);
    
    res.json({ 
      success: true,
      accessToken,
      expiresIn: 3600 // 1 час в секундах
    });
  } catch (error) {
    console.error('Ошибка проверки кода:', error);
    res.status(500).json({ error: 'Не удалось проверить код' });
  }
});

// Эндпоинт для проверки токена доступа
app.post('/api/check-access', async (req, res) => {
  const { accessToken } = req.body;
  
  if (!accessToken) {
    return res.status(401).json({ error: 'Токен не указан' });
  }
  
  try {
    // Проверяем токен в БД
    const result = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Доступ запрещен' });
    }
    
    const tokenData = result.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
    }
    
    res.json({ valid: true });
  } catch (error) {
    console.error('Ошибка проверки токена:', error);
    res.status(500).json({ error: 'Не удалось проверить токен' });
  }
});

// Получение меток пользователя
app.get('/api/marks/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const accessToken = req.headers.authorization?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Проверяем токен
    const tokenResult = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (tokenResult.rows.length === 0 || tokenResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    // Проверяем срок действия токена
    const tokenData = tokenResult.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
    }
    
    // Получаем метки пользователя
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
app.post('/api/marks', async (req, res) => {
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    const accessToken = req.headers.authorization?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Проверяем токен
    const tokenResult = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (tokenResult.rows.length === 0 || tokenResult.rows[0].user_id !== user_id) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    // Проверяем срок действия токена
    const tokenData = tokenResult.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
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
app.get('/api/tiles/bounds', async (req, res) => {
  try {
    const { west, south, east, north, limit = 1000, offset = 0 } = req.query;
    const accessToken = req.headers.authorization?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Проверяем токен
    const tokenResult = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: 'Токен недействителен' });
    }
    
    // Проверяем срок действия токена
    const tokenData = tokenResult.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
    }
    
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
