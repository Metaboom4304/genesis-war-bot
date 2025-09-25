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
const CODE_LIFETIME = 5 * 60 * 1000;

console.log('🔧 Инициализация API сервера...');

// --- Кэш для health-check ---
let healthCheckCache = {
  data: null,
  timestamp: 0,
  ttl: 30000 // 30 секунд кэширования
};

// --- Инициализация Middleware ---
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));

// УБИРАЕМ ОСНОВНОЙ RATE LIMITER - он вызывает проблемы
// Вместо этого используем более мягкие настройки для конкретных эндпоинтов

// ОЧЕНЬ МЯГКИЙ лимит для основных API эндпоинтов
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // УВЕЛИЧИЛИ до 5000 запросов за 15 минут
  message: JSON.stringify({
    status: 'error',
    error: 'Too Many Requests',
    message: 'Слишком много запросов, попробуйте позже',
    timestamp: new Date().toISOString()
  }),
  skip: (req) => {
    // Пропускаем health-check и bot-health из ограничений
    return req.path === '/health' || 
           req.path === '/api/bot-health' ||
           req.path === '/api/debug';
  },
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      error: 'Too Many Requests',
      message: 'Слишком много запросов, попробуйте позже',
      timestamp: new Date().toISOString(),
      retryAfter: Math.floor(req.rateLimit.resetTime / 1000)
    });
  }
});

// ОЧЕНЬ МЯГКИЙ лимит для health-check эндпоинтов
const healthCheckLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // УВЕЛИЧИЛИ до 300 запросов в минуту
  message: JSON.stringify({
    status: 'error',
    error: 'Too Many Requests',
    message: 'Слишком много проверок здоровья, подождите немного',
    timestamp: new Date().toISOString()
  }),
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      error: 'Too Many Requests',
      message: 'Слишком много проверок здоровья, подождите немного',
      timestamp: new Date().toISOString(),
      retryAfter: Math.floor(req.rateLimit.resetTime / 1000)
    });
  }
});

// Лимит для эндпоинтов аутентификации (более строгий)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 попыток аутентификации за 15 минут
  message: JSON.stringify({
    status: 'error',
    error: 'Too Many Requests',
    message: 'Слишком много попыток аутентификации',
    timestamp: new Date().toISOString()
  }),
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      error: 'Too Many Requests',
      message: 'Слишком много попыток аутентификации',
      timestamp: new Date().toISOString(),
      retryAfter: Math.floor(req.rateLimit.resetTime / 1000)
    });
  }
});

// Применяем лимиты ТОЛЬКО к конкретным эндпоинтам
app.use('/api/save-code', authLimiter);
app.use('/api/verify-code', authLimiter);
app.use('/health', healthCheckLimiter);
app.use('/api/bot-health', healthCheckLimiter);
// Основной API лимитер применяем ко всем остальным API эндпоинтам
app.use('/api/', apiLimiter);

// ИСПРАВЛЕННАЯ настройка CORS
app.use(cors({
  origin: function (origin, callback) {
    // Разрешаем запросы без origin (например, из мобильных приложений или локальных файлов)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://genesis-data.onrender.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'https://your-frontend-domain.com' // замените на ваш домен
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('🔒 CORS блокирован для origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
}));

app.options('*', cors());

// --- Подключение к базе данных ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- Инициализация базы данных ---
async function initDatabase() {
  try {
    console.log('🔧 Инициализация структуры базы данных...');
    
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
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        code VARCHAR(6) PRIMARY KEY,
        user_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        used BOOLEAN DEFAULT false
      );
      
      CREATE INDEX IF NOT EXISTS idx_access_codes_created ON access_codes(created_at);
    `);
    
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
    
    if (result.rowCount > 0) {
      console.log(`🧹 Очищено ${result.rowCount} старых кодов`);
    }
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
    
    if (result.rowCount > 0) {
      console.log(`🧹 Очищено ${result.rowCount} старых токенов`);
    }
  } catch (error) {
    console.error('❌ Ошибка очистки старых токенов:', error);
  }
}

// Инициализация периодической очистки
cleanupOldCodes();
cleanupOldTokens();
setInterval(cleanupOldCodes, 10 * 60 * 1000);
setInterval(cleanupOldTokens, 30 * 60 * 1000);

// --- Вспомогательные функции ---
function logRequest(endpoint, req) {
  console.log(`📨 ${endpoint} - IP: ${req.ip}, User-Agent: ${req.get('User-Agent')}`);
}

// --- API Endpoints ---

// Эндпоинт для сохранения кода - УЛУЧШЕННАЯ ВЕРСИЯ
app.post('/api/save-code', async (req, res) => {
  logRequest('POST /api/save-code', req);
  console.log('💾 Тело запроса:', req.body);
  
  const { code, userId } = req.body;
  
  if (!code || !userId) {
    console.log('❌ Отсутствуют обязательные параметры:', { code, userId });
    return res.status(400).json({ 
      error: 'Отсутствуют обязательные параметры',
      received: { code, userId }
    });
  }
  
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ 
      error: 'Код должен состоять из 6 цифр',
      received: code 
    });
  }
  
  try {
    // Очищаем старые коды для этого пользователя
    await pool.query(`
      DELETE FROM access_codes 
      WHERE user_id = $1 OR created_at < NOW() - INTERVAL '10 minutes'
    `, [userId]);
    
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
    
    if (error.code === '23505') {
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

// Эндпоинт для проверки связи между ботом и API - УЛУЧШЕННАЯ ВЕРСИЯ
app.get('/api/bot-health', async (req, res) => {
  logRequest('GET /api/bot-health', req);
  
  // Проверяем кэш
  const now = Date.now();
  if (healthCheckCache.data && (now - healthCheckCache.timestamp < healthCheckCache.ttl)) {
    console.log('✅ Возвращаем кэшированный результат health-check');
    return res.json({
      ...healthCheckCache.data,
      cached: true,
      cacheAge: Math.round((now - healthCheckCache.timestamp) / 1000)
    });
  }
  
  try {
    // Быстрая проверка подключения к БД
    const dbStart = Date.now();
    await pool.query('SELECT 1 as test');
    const dbTime = Date.now() - dbStart;
    
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'access_codes'
      );
    `);
    
    const healthData = {
      status: 'ok',
      service: 'genesis-war-api',
      database: 'connected',
      database_response_time: `${dbTime}ms`,
      access_codes_table: tableCheck.rows[0].exists,
      timestamp: new Date().toISOString(),
      cached: false,
      rate_limit_info: {
        remaining: req.rateLimit?.remaining || 'unlimited',
        limit: req.rateLimit?.limit || 'unlimited'
      }
    };
    
    // Сохраняем в кэш
    healthCheckCache = {
      data: healthData,
      timestamp: now
    };
    
    res.json(healthData);
  } catch (error) {
    console.error('❌ Ошибка health-check:', error);
    
    res.status(500).json({
      status: 'error',
      service: 'genesis-war-api',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
      cached: false
    });
  }
});

// Эндпоинт для проверки кода
app.post('/api/verify-code', async (req, res) => {
  logRequest('POST /api/verify-code', req);
  console.log('🔍 Проверка кода:', req.body.code);
  
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Код не указан' });
  }
  
  try {
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
    
    if (codeAge > CODE_LIFETIME) {
      console.log('❌ Код устарел:', code);
      await pool.query(`DELETE FROM access_codes WHERE code = $1`, [code]);
      return res.status(401).json({ error: 'Код устарел' });
    }
    
    if (accessCode.used) {
      console.log('❌ Код уже использован:', code);
      return res.status(401).json({ error: 'Код уже использован' });
    }
    
    await pool.query(`
      UPDATE access_codes 
      SET used = true 
      WHERE code = $1
    `, [code]);
    
    const accessToken = Math.random().toString(36).substr(2, 15);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    await pool.query(`
      INSERT INTO access_tokens (token, user_id, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (token) 
      DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        expires_at = EXCLUDED.expires_at
    `, [accessToken, accessCode.user_id, expiresAt]);
    
    console.log('✅ Код подтвержден, токен выдан:', { 
      code, 
      accessToken: accessToken.substring(0, 8) + '...',
      userId: accessCode.user_id,
      expiresAt 
    });
    
    res.json({ 
      success: true,
      accessToken,
      expiresIn: 3600,
      userId: accessCode.user_id
    });
  } catch (error) {
    console.error('❌ Ошибка проверки кода:', error);
    res.status(500).json({ error: 'Не удалось проверить код' });
  }
});

// Эндпоинт для проверки токена доступа
app.post('/api/check-access', async (req, res) => {
  logRequest('POST /api/check-access', req);
  console.log('🔐 Проверка токена:', req.body.accessToken ? req.body.accessToken.substring(0, 8) + '...' : 'отсутствует');
  
  const { accessToken } = req.body;
  
  if (!accessToken) {
    return res.status(401).json({ error: 'Токен не указан' });
  }
  
  try {
    const result = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (result.rows.length === 0) {
      console.log('❌ Токен не найден');
      return res.status(401).json({ error: 'Доступ запрещен' });
    }
    
    const tokenData = result.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      console.log('❌ Токен устарел');
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
    }
    
    console.log('✅ Токен действителен для пользователя:', tokenData.user_id);
    res.json({ 
      valid: true,
      userId: tokenData.user_id 
    });
  } catch (error) {
    console.error('❌ Ошибка проверки токена:', error);
    res.status(500).json({ error: 'Не удалось проверить токен' });
  }
});

// Получение меток пользователя
app.get('/api/marks/:userId', async (req, res) => {
  logRequest(`GET /api/marks/${req.params.userId}`, req);
  
  try {
    const userId = parseInt(req.params.userId);
    const accessToken = req.headers.authorization?.split(' ')[1];
    
    console.log('🔍 Запрос меток пользователя:', { userId, accessToken: !!accessToken });
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    const tokenResult = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (tokenResult.rows.length === 0 || tokenResult.rows[0].user_id !== userId) {
      console.log('❌ Неверный токен или пользователь');
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const tokenData = tokenResult.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
    }
    
    const result = await pool.query(
      `SELECT tile_id, mark_type, comment 
       FROM user_marks 
       WHERE user_id = $1`,
      [userId]
    );
    
    console.log(`✅ Найдено ${result.rows.length} меток для пользователя ${userId}`);
    
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
  logRequest('POST /api/marks', req);
  console.log('💾 Получен запрос на сохранение метки:', req.body);
  
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    const accessToken = req.headers.authorization?.split(' ')[1];
    
    console.log('🔍 Параметры метки:', { user_id, tile_id, mark_type, accessToken: !!accessToken });
    
    if (!accessToken) {
      console.log('❌ Отсутствует accessToken');
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Проверяем токен
    const tokenResult = await pool.query(`
      SELECT * FROM access_tokens 
      WHERE token = $1
    `, [accessToken]);
    
    if (tokenResult.rows.length === 0) {
      console.log('❌ Токен не найден');
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const tokenData = tokenResult.rows[0];
    const now = new Date();
    
    if (new Date(tokenData.expires_at) < now) {
      console.log('❌ Токен устарел');
      await pool.query(`DELETE FROM access_tokens WHERE token = $1`, [accessToken]);
      return res.status(401).json({ error: 'Токен устарел' });
    }
    
    if (tokenData.user_id !== parseInt(user_id)) {
      console.log('❌ Несоответствие пользователя токена и запроса');
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    if (!user_id || !tile_id || !mark_type) {
      console.log('❌ Отсутствуют обязательные поля');
      return res.status(400).json({ 
        error: 'Отсутствуют обязательные поля: user_id, tile_id, mark_type' 
      });
    }
    
    const VALID_MARK_TYPES = ['ally', 'enemy', 'favorite', 'clear', 'comment'];
    if (!VALID_MARK_TYPES.includes(mark_type)) {
      console.log('❌ Неверный тип метки:', mark_type);
      return res.status(400).json({ 
        error: `Недопустимый тип метки. Допустимые: ${VALID_MARK_TYPES.join(', ')}` 
      });
    }

    let query, values;
    
    if (mark_type === 'clear') {
      console.log('🧹 Очистка меток для тайла:', tile_id);
      query = 'DELETE FROM user_marks WHERE user_id = $1 AND tile_id = $2';
      values = [user_id, tile_id];
      await pool.query(query, values);
      
      res.status(200).json({ 
        success: true,
        message: 'Метка удалена',
        tile_id: parseInt(tile_id),
        mark_type: 'clear'
      });
    } else {
      console.log('💾 Сохранение метки:', { user_id, tile_id, mark_type });
      
      // Удаляем все существующие метки для этого тайла (чтобы была только одна активная)
      await pool.query(
        'DELETE FROM user_marks WHERE user_id = $1 AND tile_id = $2',
        [user_id, tile_id]
      );
      
      // Сохраняем новую метку
      query = `
          INSERT INTO user_marks (user_id, tile_id, mark_type, comment)
          VALUES ($1, $2, $3, $4)
          RETURNING *;
      `;
      values = [user_id, tile_id, mark_type, comment || null];
      const result = await pool.query(query, values);
      
      console.log('✅ Метка успешно сохранена:', result.rows[0]);
      
      res.status(200).json({ 
        success: true,
        mark: {
          user_id: result.rows[0].user_id,
          tile_id: result.rows[0].tile_id,
          mark_type: result.rows[0].mark_type,
          comment: result.rows[0].comment
        }
      });
    }
  } catch (error) {
    console.error('❌ Критическая ошибка сохранения метки:', error);
    res.status(500).json({ 
      error: 'Не удалось сохранить метку', 
      details: error.message 
    });
  }
});

// Диагностический endpoint - БЕЗ ОГРАНИЧЕНИЙ
app.get('/api/debug', async (req, res) => {
  logRequest('GET /api/debug', req);
  
  try {
    // Проверяем все таблицы
    const tables = ['users', 'user_marks', 'access_codes', 'access_tokens', 'tiles'];
    const results = {};
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        results[table] = result.rows[0].count;
      } catch (error) {
        results[table] = `ERROR: ${error.message}`;
      }
    }
    
    // Информация о rate limiting
    const rateLimitInfo = {
      remaining: req.rateLimit?.remaining || 'unlimited',
      limit: req.rateLimit?.limit || 'unlimited',
      resetTime: req.rateLimit?.resetTime || 'unlimited'
    };
    
    res.json({
      status: 'ok',
      service: 'genesis-war-api',
      database: 'connected',
      tables: results,
      rate_limit: rateLimitInfo,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint - БЕЗ ОГРАНИЧЕНИЙ
app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'genesis-war-api',
    timestamp: new Date().toISOString(),
    rate_limit_info: {
      note: 'Health endpoint has very relaxed rate limits'
    }
  });
});

// Эндпоинт для проверки статуса rate limiting
app.get('/api/rate-limit-status', (req, res) => {
  res.json({
    rateLimit: req.rateLimit ? {
      remaining: req.rateLimit.remaining,
      limit: req.rateLimit.limit,
      resetTime: new Date(req.rateLimit.resetTime).toISOString()
    } : 'no rate limiting applied',
    timestamp: new Date().toISOString()
  });
});

// --- Запуск сервера ---
app.listen(port, async () => {
  console.log(`🚀 Сервер API запущен на порту ${port}`);
  console.log(`🌐 CORS настроен для нескольких origin-ов`);
  console.log(`🔧 Rate limiting настроен с ОЧЕНЬ МЯГКИМИ лимитами:`);
  console.log(`   - Основные API: 5000 запросов за 15 минут`);
  console.log(`   - Health checks: 300 запросов за 1 минуту`);
  console.log(`   - Аутентификация: 100 запросов за 15 минут`);
  console.log(`   - /api/debug и /health: БЕЗ ограничений`);
  
  try {
    await initDatabase();
    console.log('✅ База данных инициализирована');
    console.log('🔧 Доступные endpoints:');
    console.log('   GET  /health');
    console.log('   GET  /api/bot-health');
    console.log('   GET  /api/debug');
    console.log('   GET  /api/rate-limit-status');
    console.log('   POST /api/save-code');
    console.log('   POST /api/verify-code');
    console.log('   POST /api/check-access');
    console.log('   GET  /api/marks/:userId');
    console.log('   POST /api/marks');
  } catch (error) {
    console.error('❌ Критическая ошибка инициализации:', error);
  }
});

export default app;
