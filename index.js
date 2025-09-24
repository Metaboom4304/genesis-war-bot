// index.js - API для GENESIS WAR MAP
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import 'dotenv/config';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Конфигурация ---
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://genesis-data.onrender.com';
const CODE_LIFETIME = 5 * 60 * 1000; // 5 минут

// --- Инициализация Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://*"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://*.t.me", "https://*.telegram.org"]
    }
  }
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));

// Ограничение количества запросов
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Слишком много запросов, попробуйте позже'
});
app.use('/api/', apiLimiter);

// Настройка CORS
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
    
    // Таблица кодов доступа (ДОБАВЛЕНО)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        code VARCHAR(6) PRIMARY KEY,
        user_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        used BOOLEAN DEFAULT false
      );
      
      CREATE INDEX IF NOT EXISTS idx_access_codes_created ON access_codes(created_at);
    `);
    
    // Таблица токенов доступа (ДОБАВЛЕНО)
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
    const result = await pool.query(`
      DELETE FROM access_codes WHERE created_at < $1
    `, [cutoffTime]);
    
    console.log(`🧹 Очищено ${result.rowCount} старых кодов`);
  } catch (error) {
    console.error('❌ Ошибка очистки старых кодов:', error);
  }
}

async function cleanupOldTokens() {
  try {
    const cutoffTime = new Date();
    const result = await pool.query(`
      DELETE FROM access_tokens WHERE expires_at < $1
    `, [cutoffTime]);
    
    console.log(`🧹 Очищено ${result.rowCount} старых токенов`);
  } catch (error) {
    console.error('❌ Ошибка очистки старых токенов:', error);
  }
}

// --- Инициализация периодической очистки ---
cleanupOldCodes();
cleanupOldTokens();
setInterval(cleanupOldCodes, 10 * 60 * 1000);
setInterval(cleanupOldTokens, 30 * 60 * 1000);

// --- API Endpoints ---

// Эндпоинт для сохранения кода (ИСПРАВЛЕННАЯ ВЕРСИЯ)
app.post('/api/save-code', async (req, res) => {
  console.log('💾 Получен запрос на сохранение кода:', req.body);
  
  const { code, userId } = req.body;
  
  if (!code || !userId) {
    console.log('❌ Отсутствуют обязательные параметры:', { code, userId });
    return res.status(400).json({ 
      error: 'Отсутствуют обязательные параметры',
      received: { code, userId }
    });
  }
  
  // Валидация кода (только цифры, длина 6)
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ 
      error: 'Код должен состоять из 6 цифр',
      received: code 
    });
  }
  
  try {
    // Сначала удаляем старые коды для этого пользователя
    await pool.query(`
      DELETE FROM access_codes 
      WHERE user_id = $1 OR created_at < NOW() - INTERVAL '10 minutes'
    `, [userId]);
    
    // Сохраняем новый код
    const result = await pool.query(`
      INSERT INTO access_codes (code, user_id, created_at, used)
      VALUES ($1, $2, NOW(), false)
      RETURNING *
    `, [code, userId]);
    
    console.log('✅ Код успешно сохранен в БД:', result.rows[0]);
    
    res.json({ 
      success: true, 
      message: 'Код сохранен',
      savedCode: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Ошибка сохранения кода в БД:', error);
    
    // Проверяем, если это ошибка уникальности (код уже существует)
    if (error.code === '23505') { // unique_violation
      // Генерируем новый код и пробуем снова
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      console.log(`🔄 Код ${code} уже существует, пробуем новый: ${newCode}`);
      
      try {
        const retryResult = await pool.query(`
          INSERT INTO access_codes (code, user_id, created_at, used)
          VALUES ($1, $2, NOW(), false)
          RETURNING *
        `, [newCode, userId]);
        
        console.log('✅ Новый код успешно сохранен:', retryResult.rows[0]);
        
        res.json({ 
          success: true, 
          message: 'Код сохранен (был сгенерирован новый из-за конфликта)',
          savedCode: retryResult.rows[0],
          newCode: newCode
        });
      } catch (retryError) {
        console.error('❌ Ошибка при повторной попытке:', retryError);
        res.status(500).json({ 
          error: 'Не удалось сохранить код после повторной попытки',
          details: retryError.message 
        });
      }
    } else {
      res.status(500).json({ 
        error: 'Не удалось сохранить код',
        details: error.message 
      });
    }
  }
});

// Эндпоинт для проверки связи между ботом и API
app.get('/api/bot-health', async (req, res) => {
  try {
    // Проверяем соединение с БД
    await pool.query('SELECT 1');
    
    // Проверяем существование таблицы access_codes
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'access_codes'
      );
    `);
    
    res.json({
      status: 'ok',
      service: 'genesis-war-api',
      database: 'connected',
      access_codes_table: tableCheck.rows[0].exists,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'genesis-war-api',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Эндпоинт для проверки кода (вызывается фронтендом)
app.post('/api/verify-code', async (req, res) => {
  const { code } = req.body;
  
  console.log('🔍 Проверка кода:', code);
  
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
      console.log('❌ Код не найден:', code);
      return res.status(404).json({ error: 'Код не найден' });
    }
    
    const accessCode = result.rows[0];
    const now = new Date();
    const codeAge = now - new Date(accessCode.created_at);
    
    // Проверяем срок действия (5 минут)
    if (codeAge > CODE_LIFETIME) {
      console.log('❌ Код устарел:', code);
      await pool.query(`DELETE FROM access_codes WHERE code = $1`, [code]);
      return res.status(401).json({ error: 'Код устарел' });
    }
    
    // Проверяем, использован ли код
    if (accessCode.used) {
      console.log('❌ Код уже использован:', code);
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
    
    console.log('✅ Код подтвержден, токен выдан:', { code, accessToken });
    
    res.json({ 
      success: true,
      accessToken,
      expiresIn: 3600
    });
  } catch (error) {
    console.error('❌ Ошибка проверки кода:', error);
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
    console.error('❌ Ошибка проверки токена:', error);
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
    console.error(`❌ Ошибка получения меток для пользователя ${req.params.userId}:`, error);
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
    console.error(`❌ Ошибка сохранения метки для пользователя ${req.body.user_id} на тайле ${req.body.tile_id}:`, error);
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
    console.error('❌ Ошибка запроса тайлов по границам:', error);
    res.status(500).json({
      error: 'Не удалось получить тайлы',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'genesis-war-api',
    timestamp: new Date().toISOString()
  });
});

// --- Запуск сервера ---
app.listen(port, async () => {
  console.log(`🚀 Сервер API запущен на порту ${port}`);
  console.log(`🌐 CORS разрешён для: ${CORS_ORIGIN}`);
  
  try {
    await initDatabase();
    console.log('✅ База данных инициализирована');
  } catch (error) {
    console.error('❌ Критическая ошибка инициализации:', error);
  }
});

export default app;
