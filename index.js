// index.js - API Сервис (genesis-map-api) с CDN кэшированием
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import fetch from 'node-fetch';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

// --- Конфигурация ---
const CORS_ORIGIN = 'https://genesis-data.onrender.com';
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут
const CDN_CACHE_MAX_AGE = 3600; // 1 час для CDN
const BROWSER_CACHE_MAX_AGE = 300; // 5 минут для браузера

// --- Middleware ---
// Явная обработка CORS для надежности
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

// --- Существующие эндпоинты (остаются без изменений) ---

app.post('/register', async (req, res) => {
  // ... существующий код без изменений
});

app.post('/api/users/register', async (req, res) => {
  // ... существующий код без изменений
});

app.get('/users', async (req, res) => {
  // ... существующий код без изменений
});

app.get('/users/:id', async (req, res) => {
  // ... существующий код без изменений
});

app.post('/notify', async (req, res) => {
  // ... существующий код без изменений
});

app.get('/api/marks/:userId', async (req, res) => {
  // ... существующий код без изменений
});

app.post('/api/marks', async (req, res) => {
  // ... существующий код без изменений
});

app.post('/api/tiles-cache', async (req, res) => {
  // ... существующий код без изменений
});

app.get('/api/proxy/tile-info', async (req, res) => {
  // ... существующий код без изменений
});

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

// Мониторинг памяти
setInterval(() => {
  const used = process.memoryUsage();
  console.log(
    `Memory usage: RSS ${Math.round(used.rss / 1024 / 1024)}MB, ` +
    `Heap ${Math.round(used.heapUsed / 1024 / 1024)}MB/${Math.round(used.heapTotal / 1024 / 1024)}MB`
  );
}, 60000); // Каждую минуту

export default app;
