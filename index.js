// index.js - API Сервис (genesis-map-api) с оптимизацией и правками
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
// ИСПРАВЛЕНО: Убраны лишние пробелы
const CORS_ORIGIN = 'https://genesis-data.onrender.com';
// ИСПРАВЛЕНО: Правильный URL для получения ВСЕХ тайлов
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php?all_info=1';
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
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
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
        data JSONB, -- Храним данные тайла как JSONB
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
      return true; // Кэш пустой
    }
    
    const now = new Date();
    const lastUpdated = new Date(latestUpdate);
    const ageMs = now - lastUpdated;
    
    console.log(`⏱️ Возраст кэша тайлов: ${Math.round(ageMs / 1000 / 60)} минут.`);
    
    return ageMs > CACHE_TTL_MS;
  } catch (error) {
    console.error('⚠️ Ошибка при проверке актуальности кэша тайлов:', error);
    // В случае ошибки лучше предположить, что кэш устарел
    return true;
  }
}

// Обновление кэша тайлов
async function refreshTileCache() {
    console.log('🔄 Начинаем обновление кэша тайлов...');
    try {
        // Таймаут для внешнего запроса
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 секунд

        // ИСПРАВЛЕНО: Используем правильный URL для получения ВСЕХ тайлов
        console.log(`📥 Выполняем GET-запрос к: ${EXTERNAL_TILE_API_URL}`);
        const response = await fetch(EXTERNAL_TILE_API_URL, {
            method: 'GET',
            signal: controller.signal
            // headers: { /* Возможно, нужны заголовки */ }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        console.log(`📥 Получен ответ. Content-Type: ${contentType}`);

        let fullResponseData;
        if (contentType && contentType.includes('application/json')) {
            fullResponseData = await response.json();
            console.log(`📥 Ответ успешно распаршен как JSON. Тип корневого объекта: ${typeof fullResponseData}`);
        } else {
            const textData = await response.text();
            console.warn(`⚠️ Ответ не является JSON. Content-Type: ${contentType}. Первые 200 символов:`, textData.substring(0, 200));
            // Попробуем распарсить как JSON, если это возможно
            try {
                fullResponseData = JSON.parse(textData);
            } catch (parseError) {
                console.error('❌ Не удалось распарсить тело ответа как JSON:', parseError.message);
                throw new Error(`Response body is not valid JSON. Content-Type was ${contentType}`);
            }
        }

        // Проверим структуру полученных данных
        console.log(`🔍 Структура полученных данных:`);
        console.log(`   - typeof fullResponseData: ${typeof fullResponseData}`);
        if (fullResponseData && typeof fullResponseData === 'object') {
            console.log(`   - isArray: ${Array.isArray(fullResponseData)}`);
            console.log(`   - keys (first 10):`, Object.keys(fullResponseData).slice(0, 10));
        }
        
        // Предполагаем, что данные тайлов находятся в поле 'tiles' или являются самим объектом
        let tileData = {};
        if (fullResponseData && typeof fullResponseData === 'object' && !Array.isArray(fullResponseData)) {
            if (fullResponseData.tiles && typeof fullResponseData.tiles === 'object') {
                tileData = fullResponseData.tiles;
                console.log(`📥 Найдено поле 'tiles'. Количество тайлов в 'tiles': ${Object.keys(tileData).length}`);
            } else {
                // Если 'tiles' нет, предполагаем, что сам объект содержит тайлы
                tileData = fullResponseData;
                console.log(`📥 Поле 'tiles' не найдено. Используем корневой объект как данные тайлов. Количество ключей: ${Object.keys(tileData).length}`);
            }
        } else if (Array.isArray(fullResponseData)) {
             console.warn(`⚠️ Полученные данные являются массивом. Это неожиданно. Количество элементов: ${fullResponseData.length}`);
             // Попробуем преобразовать, если это возможно (например, массив объектов с id)
             tileData = {};
             fullResponseData.forEach((item, index) => {
                 if (item && typeof item === 'object' && item.id_tile) {
                     tileData[item.id_tile] = item;
                 } else {
                     tileData[`item_${index}`] = item; // fallback
                 }
             });
             console.log(`📥 Массив преобразован в объект. Количество тайлов: ${Object.keys(tileData).length}`);
        } else {
            console.error(`❌ Полученные данные имеют неподдерживаемый формат: ${typeof fullResponseData}`);
            throw new Error(`Unsupported data format received from external API: ${typeof fullResponseData}`);
        }
        
        console.log(`📥 Общее количество тайлов для обработки: ${Object.keys(tileData).length}`);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            let updatedCount = 0;
            // Перебираем ключи внутри tileData (которые являются id_tile)
            for (const [tileIdStr, tileInfo] of Object.entries(tileData)) {
                const tileId = parseInt(tileIdStr, 10);
                if (isNaN(tileId)) {
                    console.warn(`⚠️ Пропущен некорректный ID тайла: ${tileIdStr}`);
                    continue;
                }
                // ВАЖНО: Сохраняем tileInfo как JSON *строку* в поле data (JSONB)
                await client.query(
                    `
                    INSERT INTO tiles_caches (tile_id, data, last_updated)
                    VALUES ($1, $2, CURRENT_TIMESTAMP)
                    ON CONFLICT (tile_id)
                    DO UPDATE SET data = EXCLUDED.data, last_updated = CURRENT_TIMESTAMP;
                    `,
                    [tileId, JSON.stringify(tileInfo)] // Всегда JSON.stringify!
                );
                updatedCount++;
            }
            
            await client.query('COMMIT');
            console.log(`✅ Кэш тайлов успешно обновлен. Обновлено записей: ${updatedCount}`);
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('❌ Таймаут при обновлении кэша тайлов (30 секунд)');
        } else {
            console.error('❌ Ошибка при обновлении кэша тайлов:', error.message);
        }
        // Отправляем уведомление об ошибке, если нужно
        return false;
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

// --- API Эндпоинты ---

// --- Эндпоинты для пользователей ---

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
  // Просто вызываем основную логику /register
  return app._router.handle({ method: 'POST', url: '/register', body: req.body }, res);
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

// --- Эндпоинты для уведомлений ---

app.post('/notify', withDatabaseErrorHandling(async (req, res) => {
  const { user_id, tile_id, action, comment } = req.body;
  console.log(`Notification: User ${user_id} performed ${action} on tile ${tile_id} with comment: ${comment}`);
  res.status(200).json({ success: true });
}));

// --- Эндпоинты для данных карты ---

// Получение меток пользователя
app.get('/api/marks/:userId', withDatabaseErrorHandling(async (req, res) => {
    const userId = req.params.userId;
    try {
        const result = await pool.query(
          'SELECT tile_id, mark_type, comment FROM user_marks WHERE user_id = $1', 
          [userId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(`Error fetching marks for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to fetch marks' });
    }
}));

// Сохранение/обновление метки пользователя
app.post('/api/marks', withDatabaseErrorHandling(async (req, res) => {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ error: 'Missing required fields: user_id, tile_id, mark_type' });
    }

    try {
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
    } catch (error) {
        console.error(`Error saving mark for user ${user_id} on tile ${tile_id}:`, error);
        res.status(500).json({ error: 'Failed to save mark', details: error.message });
    }
}));

// НОВЫЙ ЭНДПОИНТ: Получение тайлов в границах
app.get('/api/tiles-in-bounds', async (req, res) => {
  try {
    const { west, south, east, north, zoom } = req.query;

    // Базовая валидация параметров
    if (west === undefined || south === undefined || east === undefined || north === undefined) {
      return res.status(400).json({ error: 'Missing required query parameters: west, south, east, north' });
    }

    const westNum = parseFloat(west);
    const southNum = parseFloat(south);
    const eastNum = parseFloat(east);
    const northNum = parseFloat(north);
    const zoomNum = zoom ? parseInt(zoom, 10) : null;

    if (isNaN(westNum) || isNaN(southNum) || isNaN(eastNum) || isNaN(northNum) || (zoom && isNaN(zoomNum))) {
      return res.status(400).json({ error: 'Invalid query parameter types. Coordinates must be numbers.' });
    }

    console.log(`📥 Запрос тайлов в границах: W:${westNum}, S:${southNum}, E:${eastNum}, N:${northNum}, Z:${zoomNum}`);

    // === ВАЖНО: CDN ЗАГОЛОВКИ ===
    // Используем более короткое время кэширования для запросов с конкретными границами,
    // так как они уникальны для каждой области. Основное кэширование будет на фронтенде.
    res.setHeader('Cache-Control', `public, max-age=60`); // Кэшировать на 1 минуту
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Формируем SQL-запрос для получения тайлов в заданных границах
    // Предполагаем, что в JSON данных тайла есть поля lng и lat
    const query = `
      SELECT tile_id, data
      FROM tiles_caches tc
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_to_record(tc.data) AS t(lng numeric, lat numeric)
        WHERE t.lng BETWEEN $1 AND $2 AND t.lat BETWEEN $3 AND $4
      )
    `;
    const values = [westNum, eastNum, southNum, northNum];

    const result = await pool.query(query, values);
    
    const tilesObject = {};
    result.rows.forEach(row => {
      try {
        // Парсим данные тайла из JSONB
        const tileData = JSON.parse(row.data); // row.data - это строка JSON из JSONB поля
        tilesObject[row.tile_id] = { id_tile: row.tile_id, ...tileData };
      } catch (e) {
        console.error(`Ошибка парсинга данных тайла ${row.tile_id}:`, e);
      }
    });

    console.log(`📤 Возвращаем ${Object.keys(tilesObject).length} тайлов в заданных границах`);
    res.status(200).json({ 
      tiles: tilesObject,
      count: Object.keys(tilesObject).length,
      bounds: { west: westNum, south: southNum, east: eastNum, north: northNum, zoom: zoomNum },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error fetching tiles in bounds:', error);
    res.status(500).json({ 
      error: 'Failed to fetch tiles in bounds', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Главный эндпоинт для получения тайлов с CDN кэшированием (все тайлы)
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
        // Парсим данные тайла из JSONB
        const tileData = JSON.parse(row.data); // row.data - это строка JSON из JSONB поля
        tilesObject[row.tile_id] = { id_tile: row.tile_id, ...tileData };
      } catch (e) {
        console.error('Ошибка парсинга данных тайла:', e);
      }
    });
    
    console.log(`📤 Возвращаем данные из кэша. Количество тайлов: ${Object.keys(tilesObject).length}`);
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

// Проксирование запроса к внешнему источнику тайлов или получение из БД
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
         // Даже если кэш не обновился, возвращаем свежие данные
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
                 // Предполагаем, что row.data - это уже строка JSON
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
  
  console.log(`✅ genesis-map-api service started successfully. Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
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

export default app;
