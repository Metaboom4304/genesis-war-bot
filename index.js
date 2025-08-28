// index.js - API Сервис (genesis-map-api) с оптимизацией
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import fetch from 'node-fetch';
import 'dotenv/config';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3000;

// --- Конфигурация ---
const CORS_ORIGIN = 'https://genesis-data.onrender.com';
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут
const CDN_CACHE_MAX_AGE = 3600; // 1 час для CDN
const BROWSER_CACHE_MAX_AGE = 300; // 5 минут для браузера

// --- Middleware ---
// Безопасность
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Сжатие
app.use(compression({ level: 6 }));

// Лимит запросов
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Слишком много запросов, попробуйте позже'
});
app.use('/api/', apiLimiter);

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '3600');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '10mb' }));

// --- База данных ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Вспомогательные функции ---

// Проверка подключения к базе данных
async function checkDatabaseConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

// Инициализация таблиц
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_marks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        tile_id INTEGER NOT NULL,
        mark_type TEXT NOT NULL,
        comment TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, tile_id, mark_type)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiles_caches (
        tile_id INTEGER PRIMARY KEY,
        data JSONB,
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Error initializing database tables:', error);
  }
}

// Проверка актуальности кэша
async function isTileCacheStale() {
  try {
    const result = await pool.query(
      'SELECT MAX(last_updated) AS latest_update FROM tiles_caches'
    );
    const latestUpdate = result.rows[0]?.latest_update;
    
    if (!latestUpdate) {
      console.log('🔍 Кэш тайлов пуст или не существует.');
      return true;
    }
    
    const now = new Date();
    const lastUpdated = new Date(latestUpdate);
    const ageMs = now - lastUpdated;
    
    console.log(`⏱️ Возраст кэша тайлов: ${Math.round(ageMs / 1000 / 60)} минут`);
    
    return ageMs > CACHE_TTL_MS;
  } catch (error) {
    console.error('⚠️ Ошибка при проверке актуальности кэша тайлов:', error);
    return true;
  }
}

// Обновление кэша тайлов
async function refreshTileCache() {
  console.log('🔄 Начинаем обновление кэша тайлов...');
  let client;
  
  try {
    // Таймаут для внешнего запроса
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(EXTERNAL_TILE_API_URL, {
      signal: controller.signal,
      timeout: 30000
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const fullResponseData = await response.json();
    const tileData = fullResponseData.tiles || {};
    
    console.log(`📥 Получены данные ${Object.keys(tileData).length} тайлов от внешнего API`);
    
    client = await pool.connect();
    await client.query('BEGIN');
    
    // Пакетная обработка для экономии памяти
    const batchSize = 100;
    const tileEntries = Object.entries(tileData);
    let processedCount = 0;
    
    for (let i = 0; i < tileEntries.length; i += batchSize) {
      const batch = tileEntries.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];
      
      batch.forEach(([tileIdStr, tileInfo], index) => {
        const tileId = parseInt(tileIdStr, 10);
        if (!isNaN(tileId)) {
          values.push(tileId, JSON.stringify(tileInfo));
          placeholders.push(`($${values.length - 1}, $${values.length}, CURRENT_TIMESTAMP)`);
        }
      });
      
      if (values.length > 0) {
        const query = `
          INSERT INTO tiles_caches (tile_id, data, last_updated)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (tile_id)
          DO UPDATE SET data = EXCLUDED.data, last_updated = CURRENT_TIMESTAMP
        `;
        
        await client.query(query, values);
        processedCount += batch.length;
      }
      
      // Даем event loop передышку
      if (i + batchSize < tileEntries.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    await client.query('COMMIT');
    console.log(`✅ Кэш тайлов успешно обновлен. Обработано записей: ${processedCount}`);
    return true;
    
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(e => console.error('Rollback error:', e));
    
    if (error.name === 'AbortError') {
      console.error('❌ Таймаут при обновлении кэша тайлов (30 секунд)');
    } else {
      console.error('❌ Ошибка при обновлении кэша тайлов:', error.message);
    }
    return false;
  } finally {
    if (client) {
      try {
        client.release();
      } catch (e) {
        console.error('Error releasing client:', e);
      }
    }
  }
}

// Обработчик ошибок БД
function withDatabaseErrorHandling(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('Database error:', error);
      
      if (error.code === '23505') { // unique violation
        return res.status(409).json({ error: 'Duplicate entry' });
      }
      if (error.code === '23503') { // foreign key violation
        return res.status(400).json({ error: 'Invalid reference' });
      }
      
      res.status(500).json({ 
        error: 'Database error', 
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
      });
    }
  };
}

// --- CDN-оптимизированные эндпоинты ---

// Главный эндпоинт для получения тайлов с CDN кэшированием
app.get('/api/tiles-cache', async (req, res) => {
  try {
    console.log('📥 Запрос к /api/tiles-cache');
    
    // === ВАЖНО: CDN ЗАГОЛОВКИ ===
    res.setHeader('Cache-Control', `public, max-age=${BROWSER_CACHE_MAX_AGE}, s-maxage=${CDN_CACHE_MAX_AGE}`);
    res.setHeader('CDN-Cache-Control', `max-age=${CDN_CACHE_MAX_AGE}`);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Фоновое обновление кэша если нужно
    isTileCacheStale().then(async isStale => {
      if (isStale) {
        console.log('🔄 Кэш устарел. Инициируем фоновое обновление...');
        try {
          await refreshTileCache();
        } catch (err) {
          console.error('Фоновое обновление кэша не удалось:', err);
        }
      }
    }).catch(err => {
      console.error('Ошибка при проверке кэша:', err);
    });
    
    // Немедленно возвращаем данные из кэша
    const result = await pool.query(`
      SELECT tile_id, data 
      FROM tiles_caches 
      ORDER BY tile_id
    `);
    
    const tilesObject = {};
    result.rows.forEach(row => {
      try {
        tilesObject[row.tile_id] = JSON.parse(row.data);
      } catch (e) {
        console.error('Ошибка парсинга данных тайла:', e);
      }
    });
    
    console.log(`📤 Возвращаем ${Object.keys(tilesObject).length} тайлов`);
    res.status(200).json({ 
      tiles: tilesObject,
      cached: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error fetching tiles cache:', error.message);
    
    // Всегда возвращаем успешный ответ с fallback данными
    res.status(200).json({ 
      tiles: {}, 
      error: 'cache_unavailable',
      message: 'Using fallback data',
      timestamp: new Date().toISOString()
    });
  }
});

// Эндпоинт для принудительного обновления кэша (без CDN кэширования)
app.get('/api/tiles-cache/refresh', async (req, res) => {
  try {
    console.log('🔄 Принудительное обновление кэша тайлов');
    
    // Отключаем кэширование для этого эндпоинта
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    
    const success = await refreshTileCache();
    
    if (success) {
      res.status(200).json({ 
        success: true, 
        message: 'Cache refreshed successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Cache refresh failed',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Error forcing cache refresh:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Эндпоинт для проверки статуса кэша
app.get('/api/tiles-cache/status', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    
    const [cacheResult, countResult] = await Promise.all([
      pool.query('SELECT MAX(last_updated) AS last_update FROM tiles_caches'),
      pool.query('SELECT COUNT(*) AS count FROM tiles_caches')
    ]);
    
    const lastUpdate = cacheResult.rows[0]?.last_update;
    const tileCount = countResult.rows[0]?.count || 0;
    const isStale = await isTileCacheStale();
    
    res.status(200).json({
      tile_count: parseInt(tileCount),
      last_updated: lastUpdate,
      is_stale: isStale,
      cache_ttl_minutes: Math.round(CACHE_TTL_MS / 60000),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting cache status:', error);
    res.status(500).json({ 
      error: 'Failed to get cache status',
      timestamp: new Date().toISOString()
    });
  }
});

// Эндпоинт для проверки использования БД
app.get('/api/db-usage', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as db_size,
        (SELECT COUNT(*) FROM tiles_caches) as tiles_count,
        (SELECT COUNT(*) FROM user_marks) as marks_count
    `);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для очистки старых данных
app.post('/api/cleanup', async (req, res) => {
  try {
    // Очистка старых данных
    await pool.query(`
      DELETE FROM tiles_caches 
      WHERE last_updated < NOW() - INTERVAL '7 days'
    `);
    
    await pool.query(`
      DELETE FROM user_marks 
      WHERE created_at < NOW() - INTERVAL '30 days'
    `);
    
    res.json({ success: true, message: "Cleanup completed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Существующие эндпоинты (с обработкой ошибок) ---

app.post('/register', withDatabaseErrorHandling(async (req, res) => {
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
}));

app.post('/api/users/register', withDatabaseErrorHandling(async (req, res) => {
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
}));

app.get('/users', withDatabaseErrorHandling(async (req, res) => {
  const result = await pool.query('SELECT telegram_id FROM users');
  const userIds = result.rows.map(row => row.telegram_id);
  res.status(200).json(userIds);
}));

app.get('/users/:id', withDatabaseErrorHandling(async (req, res) => {
  const userId = req.params.id;
  const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
  
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.status(200).json(result.rows[0]);
}));

app.post('/notify', withDatabaseErrorHandling(async (req, res) => {
  const { user_id, tile_id, action, comment } = req.body;
  console.log(`Notification: User ${user_id} performed ${action} on tile ${tile_id} with comment: ${comment}`);
  res.status(200).json({ success: true });
}));

app.get('/api/marks/:userId', withDatabaseErrorHandling(async (req, res) => {
  const userId = req.params.userId;
  const result = await pool.query(
    'SELECT tile_id, mark_type, comment FROM user_marks WHERE user_id = $1', 
    [userId]
  );
  res.status(200).json(result.rows);
}));

app.post('/api/marks', withDatabaseErrorHandling(async (req, res) => {
  const { user_id, tile_id, mark_type, comment } = req.body;
  
  if (!user_id || !tile_id || !mark_type) {
    return res.status(400).json({ error: 'Missing required fields: user_id, tile_id, mark_type' });
  }

  let query, values;
  if (mark_type === 'clear') {
    query = 'DELETE FROM user_marks WHERE user_id = $1 AND tile_id = $2';
    values = [user_id, tile_id];
  } else {
    query = `
      INSERT INTO user_marks (user_id, tile_id, mark_type, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, tile_id, mark_type)
      DO UPDATE SET comment = EXCLUDED.comment, created_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    values = [user_id, tile_id, mark_type, comment || null];
  }
  
  const result = await pool.query(query, values);
  
  if (mark_type === 'clear' && result.rowCount === 0) {
    res.status(200).json({ success: true, message: 'Mark cleared (was not present)' });
  } else {
    res.status(200).json({ success: true, mark: result.rows[0] || null });
  }
}));

app.post('/api/tiles-cache', withDatabaseErrorHandling(async (req, res) => {
  const { tiles: tilesData } = req.body; 
  
  if (!tilesData || typeof tilesData !== 'object') {
    return res.status(400).json({ error: 'Invalid data format for tiles cache. Expected { tiles: { ... } }' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    
    let updatedCount = 0;
    for (const [tileIdStr, tileData] of Object.entries(tilesData)) {
      const tileId = parseInt(tileIdStr, 10);
      if (isNaN(tileId)) {
        console.warn(`⚠️ Пропущен некорректный ID тайла при сохранении кэша: ${tileIdStr}`);
        continue;
      }
      await client.query(
        `
        INSERT INTO tiles_caches (tile_id, data, last_updated)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (tile_id)
        DO UPDATE SET data = EXCLUDED.data, last_updated = CURRENT_TIMESTAMP;
        `,
        [tileId, JSON.stringify(tileData)]
      );
      updatedCount++;
    }
    
    await client.query('COMMIT');
    res.status(200).json({ success: true, message: `Tiles cache updated. Updated records: ${updatedCount}` });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}));

app.get('/api/proxy/tile-info', withDatabaseErrorHandling(async (req, res) => {
  console.log('📥 Прямой запрос к /api/proxy/tile-info. Обновляем кэш и возвращаем сырые данные.');
  try {
    // Принудительно обновляем кэш
    const refreshSuccess = await refreshTileCache();
    
    // Получаем сырые данные от внешнего API для ответа
    const response = await fetch(EXTERNAL_TILE_API_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const rawData = await response.json();
    
    if (refreshSuccess) {
      res.status(200).json({ ...rawData, message: "Data fetched and cache updated" });
    } else {
      res.status(200).json({ ...rawData, message: "Data fetched, but cache update failed", cache_update_success: false });
    }
  } catch (error) {
    console.error('❌ Error in /api/proxy/tile-info:', error);
    // Вместо ошибки 500, можно вернуть данные из кэша, если они есть
    try {
      const cacheResult = await pool.query('SELECT tile_id, data FROM tiles_caches LIMIT 1');
      if (cacheResult.rows.length > 0) {
        console.log("⚠️ Внешний API недоступен, возвращаем данные из кэша как запасной вариант.");
        const tilesObject = {};
        cacheResult.rows.forEach(row => {
          tilesObject[row.tile_id] = { id_tile: row.tile_id, ...JSON.parse(row.data) };
        });
        return res.status(200).json({ tiles: tilesObject, message: "External API failed, data from cache", from_cache: true });
      }
    } catch (cacheError) {
      console.error("❌ Ошибка при попытке получить данные из кэша как запасной вариант:", cacheError);
    }
    res.status(500).json({ error: 'Failed to fetch proxy tile info', details: error.message });
  }
}));

// --- Health checks ---
app.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).json({ 
    status: 'OK', 
    service: 'genesis-map-api',
    memory_usage: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
    uptime: `${Math.round(process.uptime())}s`,
    timestamp: new Date().toISOString()
  });
});

app.get('/health/db', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'OK', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// --- Запуск сервера ---

// Автоочистка старых данных
setInterval(async () => {
  try {
    // Очищаем кэш тайлов старше 7 дней
    await pool.query(`
      DELETE FROM tiles_caches 
      WHERE last_updated < NOW() - INTERVAL '7 days'
    `);
    
    // Очищаем старые метки пользователей
    await pool.query(`
      DELETE FROM user_marks 
      WHERE created_at < NOW() - INTERVAL '30 days'
    `);
    
    console.log('✅ Автоочистка данных выполнена');
  } catch (error) {
    console.error('❌ Ошибка автоочистки:', error);
  }
}, 24 * 60 * 60 * 1000); // Каждые 24 часа

// Мониторинг памяти
setInterval(() => {
  const used = process.memoryUsage();
  const memoryUsage = {
    rss: Math.round(used.rss / 1024 / 1024) + 'MB',
    heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB',
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB',
    external: Math.round(used.external / 1024 / 1024) + 'MB'
  };
  console.log('Memory usage:', memoryUsage);
}, 30000); // Каждые 30 секунд

app.listen(port, async () => {
  console.log(`🚀 genesis-map-api server is running on port ${port}`);
  console.log(`🌐 CORS enabled for: ${CORS_ORIGIN}`);
  console.log(`💾 CDN cache max-age: ${CDN_CACHE_MAX_AGE} seconds`);
  
  await initDatabase();
  await checkDatabaseConnection();
  
  console.log("🔍 Проверяем кэш тайлов при запуске...");
  const isStale = await isTileCacheStale();
  
  if (isStale) {
    console.log("🔄 Кэш устарел при запуске. Обновляем...");
    await refreshTileCache();
  } else {
    console.log("✅ Кэш тайлов актуален при запуске.");
  }
  
  console.log(`✅ Service started successfully. Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
});

// --- Обработка ошибок ---
pool.on('error', (err) => {
  console.error('❌ Unexpected database error', err);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

export default app;
