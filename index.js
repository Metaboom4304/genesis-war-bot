// index.js - Оптимизированный API для 65,000+ тайлов с PostGIS
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import fetch from 'node-fetch';
import 'dotenv/config';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Настройки ---
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://genesis-data.onrender.com';
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут
const MAX_TILES_PER_REQUEST = 2000; // Максимум тайлов за один запрос
const MIN_TILE_ID = 1;
const MAX_TILE_ID = 10000000;
const MAX_ZOOM = 22; // Максимальный уровень зума для тайлов

// --- Инициализация Middleware ---
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://*.t.me", "https://*.telegram.org"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://*.t.me", "https://*.telegram.org"],
      imgSrc: ["'self'", "data:", "https://*.t.me", "https://*.telegram.org"],
      connectSrc: ["'self'", process.env.API_URL || 'https://genesis-map-api.onrender.com'],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://*.t.me", "https://*.telegram.org"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(compression({ level: 6 }));

// Ограничение количества запросов для защиты API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 1000, // максимум 1000 запросов с одного IP
  message: 'Слишком много запросов, попробуйте позже',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Настройка CORS для разрешения запросов с фронтенда
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Telegram-Init-Data'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Обработка OPTIONS для CORS preflight
app.options('/api/*', cors());

// Парсинг JSON в теле запроса
app.use(express.json({ limit: '50mb' }));

// --- Подключение к базе данных PostgreSQL (Neon) с PostGIS ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- Вспомогательные функции ---

/**
 * Инициализирует структуру базы данных: создает таблицы и индексы, если их еще нет.
 */
async function initDatabase() {
  try {
    console.log('🔧 Инициализация структуры базы данных...');
    
    // Устанавливаем расширение PostGIS, если не установлено
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    console.log('✅ PostGIS расширение установлено');
    
    // Таблица пользователей Telegram
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT,
        username TEXT,
        language_code TEXT,
        is_premium BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
    `);
    console.log('✅ Таблица users создана');

    // Таблица пользовательских меток на тайлах
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_marks (
        user_id BIGINT NOT NULL,
        tile_id INTEGER NOT NULL,
        mark_type VARCHAR(20) NOT NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, tile_id, mark_type)
      ) PARTITION BY LIST (mark_type);
      
      -- Создаем партиции для каждой метки
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_marks_ally') THEN
          CREATE TABLE user_marks_ally PARTITION OF user_marks
            FOR VALUES IN ('ally');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_marks_enemy') THEN
          CREATE TABLE user_marks_enemy PARTITION OF user_marks
            FOR VALUES IN ('enemy');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_marks_favorite') THEN
          CREATE TABLE user_marks_favorite PARTITION OF user_marks
            FOR VALUES IN ('favorite');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_marks_clear') THEN
          CREATE TABLE user_marks_clear PARTITION OF user_marks
            FOR VALUES IN ('clear');
        END IF;
      END $$;
      
      CREATE INDEX IF NOT EXISTS idx_user_marks_user_id ON user_marks(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_marks_tile_id ON user_marks(tile_id);
    `);
    console.log('✅ Таблица user_marks создана с партиционированием');

    // Основная таблица кэшированных данных тайлов с PostGIS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiles (
        tile_id INTEGER PRIMARY KEY,
        geom GEOMETRY(POINT, 4326) NOT NULL,
        has_owner BOOLEAN NOT NULL DEFAULT false,
        owner_id BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      -- Индекс для геометрии (ускоряет запросы по области)
      CREATE INDEX IF NOT EXISTS idx_tiles_geom ON tiles USING GIST (geom);
      CREATE INDEX IF NOT EXISTS idx_tiles_has_owner ON tiles(has_owner);
      CREATE INDEX IF NOT EXISTS idx_tiles_tile_id ON tiles(tile_id);
    `);
    console.log('✅ Таблица tiles создана с PostGIS');

    console.log('✅ Структура базы данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
    throw error;
  }
}

// --- Флаг блокировки для обновления кэша ---
let isRefreshing = false;

/**
 * Обновляет локальный кэш тайлов, загружая данные с внешнего API.
 * @returns {Promise<boolean>} true, если обновление прошло успешно, иначе false.
 */
async function refreshTileCache() {
  // --- Блокировка одновременных обновлений ---
  if (isRefreshing) {
    console.log('🔄 Обновление кэша уже в процессе, пропускаем...');
    return false;
  }
  
  isRefreshing = true;
  console.log('🔄 Начало обновления кэша тайлов...');
  
  try {
    // --- 1. Загрузка данных с внешнего сервера ---
    console.log(`📥 Запрос данных у внешнего API: ${EXTERNAL_TILE_API_URL}`);
    
    // --- Таймаут и обработка ошибок сети ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    try {
      const response = await fetch(EXTERNAL_TILE_API_URL, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Genesis-Map-API/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const rawData = await response.json();
      // Предполагаем, что данные могут быть в формате {tiles: {...}} или сразу {...}
      const tilesData = rawData.tiles || rawData;
      
      if (!tilesData || typeof tilesData !== 'object') {
        throw new Error('Неверный формат данных тайлов от внешнего API');
      }

      const tileEntries = Object.entries(tilesData);
      console.log(`📥 Получено ${tileEntries.length} тайлов от внешнего API`);

      // --- 2. Пакетная вставка/обновление в базу данных ---
      const batchSize = 1000; // Размер пакета для оптимизации
      let processed = 0;

      for (let i = 0; i < tileEntries.length; i += batchSize) {
        const batch = tileEntries.slice(i, i + batchSize);
        
        // Подготавливаем данные для пакетного запроса
        const values = [];
        const valuePlaceholders = [];

        for (const [index, [tileIdStr, tileData]] of batch.entries()) {
          const tileId = parseInt(tileIdStr, 10);
          
          // Строгая валидация tileId
          if (isNaN(tileId) || tileId < MIN_TILE_ID || tileId > MAX_TILE_ID) {
            console.warn(`⚠️ Пропущен тайл с некорректным ID: ${tileIdStr}`);
            continue;
          }

          const lng = parseFloat(tileData.lng) || 0;
          const lat = parseFloat(tileData.lat) || 0;
          
          // Проверяем, что координаты в допустимом диапазоне
          if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            console.warn(`⚠️ Пропущен тайл с некорректными координатами: ${tileId} (${lat}, ${lng})`);
            continue;
          }
          
          // Добавляем значения в плоский массив
          values.push(
            tileId,
            lng,
            lat,
            tileData.has_owner === 'true'
          );
          
          // Создаем строку placeholder'ов для этой записи
          const baseIndex = values.length - 4;
          valuePlaceholders.push(`($${baseIndex}, ST_SetSRID(ST_MakePoint($${baseIndex+1}, $${baseIndex+2}), 4326), $${baseIndex+3})`);
        }

        // Если в пакете есть корректные данные, выполняем запрос
        if (values.length > 0) {
          // Формируем SQL-запрос для пакетной вставки
          const query = `
            INSERT INTO tiles (tile_id, geom, has_owner)
            VALUES ${valuePlaceholders.join(', ')}
            ON CONFLICT (tile_id) 
            DO UPDATE SET 
              geom = EXCLUDED.geom,
              has_owner = EXCLUDED.has_owner,
              updated_at = CASE 
                WHEN EXCLUDED.has_owner != tiles.has_owner THEN NOW() 
                ELSE tiles.updated_at 
              END
            WHERE tiles.updated_at < NOW() - INTERVAL '5 minutes'
          `;

          // Выполняем запрос с подготовленными значениями
          await pool.query(query, values);
          processed += batch.length;
          console.log(`✅ Обработано ${processed}/${tileEntries.length} тайлов`);
        }
      }

      console.log(`🎉 Обновление кэша завершено: ${processed} тайлов обновлено`);
      return true;
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error('❌ Запрос к внешнему API превысил таймаут (60 сек)');
      } else {
        console.error('❌ Ошибка сети при запросе к внешнему API:', fetchError.message);
      }
      return false;
    }
  } catch (error) {
    console.error('❌ Критическая ошибка обновления кэша:', error.message);
    return false; 
  } finally {
    // Сброс флага блокировки
    isRefreshing = false;
  }
}

// --- API Endpoints ---

/**
 * POST /api/users/register
 * Регистрирует или обновляет информацию о пользователе Telegram.
 */
app.post('/api/users/register', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language_code, is_premium, auth_date } = req.body;

    // Базовая валидация
    if (!telegram_id || !first_name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Отсутствуют обязательные поля: telegram_id и first_name' 
      });
    }

    const query = `
      INSERT INTO users (telegram_id, first_name, last_name, username, language_code, is_premium, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (telegram_id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code,
        is_premium = EXCLUDED.is_premium,
        updated_at = NOW()
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
    res.status(200).json({ 
      success: true, 
      user: {
        id: result.rows[0].telegram_id,
        first_name: result.rows[0].first_name,
        last_name: result.rows[0].last_name,
        username: result.rows[0].username,
        language_code: result.rows[0].language_code,
        is_premium: result.rows[0].is_premium
      }
    });
  } catch (error) {
    console.error('Ошибка регистрации пользователя:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка базы данных',
      message: error.message
    });
  }
});

/**
 * GET /api/marks/:userId
 * Получает все метки пользователя.
 */
app.get('/api/marks/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    // Валидация userId
    if (isNaN(userId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Некорректный формат ID пользователя' 
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

/**
 * POST /api/marks
 * Создает, обновляет или удаляет метку пользователя на тайле.
 */
app.post('/api/marks', async (req, res) => {
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    // Строгая валидация mark_type
    const VALID_MARK_TYPES = ['ally', 'enemy', 'favorite', 'clear'];
    
    // Валидация
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ 
        success: false,
        error: 'Отсутствуют обязательные поля: user_id, tile_id, mark_type' 
       });
    }
    
    // Дополнительная валидация
    if (!VALID_MARK_TYPES.includes(mark_type)) {
      return res.status(400).json({ 
        success: false,
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
          success: true, 
          message: 'Метка удалена' 
        });
    } else {
        // Создание или обновление метки
        query = `
            INSERT INTO user_marks (user_id, tile_id, mark_type, comment, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id, tile_id, mark_type)
            DO UPDATE SET 
              comment = EXCLUDED.comment, 
              updated_at = NOW()
            RETURNING *;
        `;
        values = [user_id, tile_id, mark_type, comment || null];
        const result = await pool.query(query, values);
        res.status(200).json({ 
          success: true, 
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
      success: false,
      error: 'Не удалось сохранить метку', 
      details: error.message 
    });
  }
});

/**
 * GET /api/tiles/bounds
 * Получает тайлы в пределах заданных географических границ.
 */
app.get('/api/tiles/bounds', async (req, res) => {
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
         success: false,
         error: 'Некорректные параметры границ: west, south, east, north должны быть числами'
       });
    }

    const queryLimit = Math.min(parseInt(limit), MAX_TILES_PER_REQUEST);
    const queryOffset = Math.max(parseInt(offset), 0);

    // Создаем геометрический объект для поиска
    const query = `
      SELECT 
        tile_id,
        ST_X(geom) as lng,
        ST_Y(geom) as lat,
        has_owner
      FROM tiles 
      WHERE ST_Contains(
        ST_MakeEnvelope($1, $2, $3, $4, 4326),
        geom
      )
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
      lng: parseFloat(row.lng),
      lat: parseFloat(row.lat),
      has_owner: row.has_owner ? 'true' : 'false'
    }));

    // Подсчет общего количества для пагинации
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tiles 
      WHERE ST_Contains(
        ST_MakeEnvelope($1, $2, $3, $4, 4326),
        geom
      )
    `, [
      bounds.west, bounds.south, 
      bounds.east, bounds.north
    ]);
    
    const totalCount = parseInt(countResult.rows[0].count, 10);

    res.json({
      success: true,
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
      success: false,
      error: 'Не удалось получить тайлы',
      message: error.message
    });
  }
});

/**
 * GET /api/tiles/count
 * Возвращает общее количество тайлов в кэше.
 */
app.get('/api/tiles/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM tiles');
    res.json({
      success: true,
      count: parseInt(result.rows[0].count, 10),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Ошибка получения количества тайлов:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Не удалось получить количество тайлов',
      message: error.message 
    });
  }
});

/**
 * POST /api/cache/refresh
 * Принудительно запускает обновление кэша тайлов.
 */
app.post('/api/cache/refresh', async (req, res) => {
  try {
    console.log('🔄 Ручной запуск обновления кэша по запросу API...');
    const success = await refreshTileCache();
    res.json({ 
      success, 
      message: success ? 'Кэш успешно обновлён' : 'Ошибка обновления кэша' 
    });
  } catch (error) {
    console.error('Ошибка ручного обновления кэша:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка ручного обновления кэша',
      message: error.message 
    });
  }
});

/**
 * GET /health
 * Проверка состояния API и подключения к БД.
 */
app.get('/health', async (req, res) => {
  try {
    // Простой запрос к БД для проверки подключения
    await pool.query('SELECT 1');
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message 
    });
  }
});

// --- Запуск сервера ---
app.listen(port, async () => {
  console.log(`🚀 Сервер API запущен на порту ${port}`);
  console.log(`🌐 CORS разрешён для: ${CORS_ORIGIN}`);
  
  try {
    // Инициализируем БД и запускаем первоначальное обновление кэша
    await initDatabase();
    const cacheSuccess = await refreshTileCache();
    
    if (!cacheSuccess) {
      console.warn('⚠️ Первоначальное обновление кэша не удалось. Сервер запущен, но данные могут быть неактуальны.');
    }
    
    // Запускаем периодическое обновление кэша
    setInterval(async () => {
      console.log('⏰ Запланированное обновление кэша...');
      await refreshTileCache();
    }, CACHE_TTL_MS);
    
    console.log(`⏰ Периодическое обновление кэша запланировано каждые ${CACHE_TTL_MS / 1000 / 60} минут.`);
  } catch (error) {
    console.error('❌ Критическая ошибка инициализации:', error);
    // Даже при ошибке продолжаем работу, чтобы сервер был доступен
  }
});

export default app;
