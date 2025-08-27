// index.js - API Сервис (genesis-map-api)
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
// 1. Импортируем node-fetch
import fetch from 'node-fetch'; // Установите: npm install node-fetch
import 'dotenv/config'; // Убедитесь, что dotenv/config импортирован

const app = express();
const port = process.env.PORT || 3000;

// --- Middleware ---
// ВАЖНО: CORS должен быть первым, чтобы корректно обрабатывать preflight OPTIONS запросы
// Также увеличим лимит размера payload, если данные большие
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит, если данные большие
app.use(cors({
  origin: true, // Отражает origin запроса. Можно заменить на 'https://genesis-data.onrender.com' для большей безопасности.
  optionsSuccessStatus: 200
}));

// Настройка подключения к базе данных Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Проверка подключения к базе данных
async function checkDatabaseConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    client.release();
    
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      );
    `);
    
    console.log('Users table exists:', tableCheck.rows[0].exists);

    const marksTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'user_marks'
      );
    `);
    console.log('User_marks table exists:', marksTableCheck.rows[0].exists);

    const tilesTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'tiles_caches'
      );
    `);
    console.log('Tiles_caches table exists:', tilesTableCheck.rows[0].exists);

  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

// Создаем таблицы, если они не существуют
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

    // Убедимся, что структура таблицы tiles_caches соответствует ожиданиям
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

// --- Логика кэширования тайлов ---
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут в миллисекундах

/**
 * Обновляет кэш тайлов, запрашивая данные у внешнего API.
 * @returns {Promise<boolean>} true, если обновление прошло успешно, иначе false.
 */
async function refreshTileCache() {
    console.log('🔄 Начинаем обновление кэша тайлов...');
    try {
        const response = await fetch(EXTERNAL_TILE_API_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const fullResponseData = await response.json();
        console.log(`📥 Получены данные тайлов от внешнего API. Количество ключей в ответе: ${Object.keys(fullResponseData).length}`);

        // Предполагаем, что данные тайлов находятся в поле 'tiles'
        const tileData = fullResponseData.tiles;
        if (!tileData || typeof tileData !== 'object') {
             console.warn('⚠️ Внешний API не вернул ожидаемое поле "tiles" или оно не является объектом.');
             return false;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            let updatedCount = 0;
            // Перебираем только ключи внутри tileData (которые являются id_tile)
            for (const [tileIdStr, tileInfo] of Object.entries(tileData)) {
                const tileId = parseInt(tileIdStr, 10);
                if (isNaN(tileId)) {
                    console.warn(`⚠️ Пропущен некорректный ID тайла: ${tileIdStr}`);
                    continue;
                }
                // Вставляем или обновляем запись в кэше
                await client.query(
                    `
                    INSERT INTO tiles_caches (tile_id, data, last_updated)
                    VALUES ($1, $2, CURRENT_TIMESTAMP)
                    ON CONFLICT (tile_id)
                    DO UPDATE SET data = EXCLUDED.data, last_updated = CURRENT_TIMESTAMP;
                    `,
                    [tileId, JSON.stringify(tileInfo)]
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
        console.error('❌ Ошибка при обновлении кэша тайлов:', error);
        return false;
    }
}

/**
 * Проверяет, нуждается ли кэш тайлов в обновлении.
 * @returns {Promise<boolean>} true, если кэш устарел или отсутствует, иначе false.
 */
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
        
        console.log(`⏱️ Возраст кэша тайлов: ${(ageMs / 1000 / 60).toFixed(2)} минут.`);
        
        return ageMs > CACHE_TTL_MS;
    } catch (error) {
        console.error('⚠️ Ошибка при проверке актуальности кэша тайлов:', error);
        // В случае ошибки лучше предположить, что кэш устарел
        return true;
    }
}

// --- API Эндпоинты ---

// --- Эндпоинты для пользователей ---

app.post('/register', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('❌ Error registering user:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Database operation failed'
    });
  }
});

// Альтернативный эндпоинт для фронтенда
app.post('/api/users/register', async (req, res) => {
  // Делегируем основному обработчику
  // Используем правильный способ вызова другого маршрута
  try {
      await app._router.handle({ method: 'POST', url: '/register', body: req.body }, res);
  } catch (error) {
      // Если делегирование не сработало, повторяем логику
      console.warn('Делегирование /api/users/register -> /register не удалось, выполняем логику напрямую.');
      return app._router.stack.find(layer => layer.route?.path === '/register')?.handle(req, res);
  }
});

app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT telegram_id FROM users');
    const userIds = result.rows.map(row => row.telegram_id);
    res.status(200).json(userIds);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Эндпоинты для уведомлений ---

app.post('/notify', async (req, res) => {
  try {
    const { user_id, tile_id, action, comment } = req.body;
    console.log(`Notification: User ${user_id} performed ${action} on tile ${tile_id} with comment: ${comment}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error processing notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Эндпоинты для данных карты ---

// Получение меток пользователя
app.get('/api/marks/:userId', async (req, res) => {
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
});

// Сохранение/обновление метки пользователя
app.post('/api/marks', async (req, res) => {
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
});

// Получение кэшированной информации о тайлах
// Теперь этот эндпоинт возвращает данные из таблицы tiles_caches
app.get('/api/tiles-cache', async (req, res) => {
    try {
        console.log('📥 Запрос к /api/tiles-cache');
        
        // Проверяем, нуждается ли кэш в обновлении
        const isStale = await isTileCacheStale();
        if (isStale) {
            console.log('🔄 Кэш устарел. Инициируем обновление...');
            const refreshSuccess = await refreshTileCache();
            if (!refreshSuccess) {
                 console.warn('⚠️ Не удалось обновить кэш тайлов. Возвращаем существующие данные (если есть).');
                 // Не возвращаем ошибку 500, чтобы фронтенд мог использовать старые данные или тестовые
            }
        }

        // Получаем данные из кэша
        const result = await pool.query('SELECT tile_id, data FROM tiles_caches');
        
        // Преобразуем результат в объект, где ключи - id_tile
        const tilesObject = {};
        result.rows.forEach(row => {
            // Предполагаем, что data содержит всю необходимую информацию о тайле
            tilesObject[row.tile_id] = { id_tile: row.tile_id, ...JSON.parse(row.data) };
        });

        console.log(`📤 Возвращаем данные из кэша. Количество тайлов: ${Object.keys(tilesObject).length}`);
        res.status(200).json({ tiles: tilesObject });
    } catch (error) {
        console.error('❌ Error fetching tiles cache:', error);
        // В случае ошибки БД можно вернуть пустой объект или тестовые данные
        res.status(200).json({ tiles: {} }); // Или res.status(500).json({ error: 'Failed to fetch tiles cache' });
    }
});

// Сохранение кэша тайлов (если фронтенд или другой сервис его обновляет)
// Этот эндпоинт может быть полезен, но основное обновление теперь происходит внутри /api/tiles-cache
app.post('/api/tiles-cache', async (req, res) => {
    // req.body должно содержать данные для кэширования, например { tilesResponse }
    // Предполагаем, что структура req.body такая же, как у внешнего API: { tiles: { ... } }
    const { tiles: tilesData } = req.body; 
    
    if (!tilesData || typeof tilesData !== 'object') {
        return res.status(400).json({ error: 'Invalid data format for tiles cache. Expected { tiles: { ... } }' });
    }

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            let updatedCount = 0;
            // Перебираем только ключи внутри tilesData (которые являются id_tile)
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
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error saving tiles cache:', error);
        res.status(500).json({ error: 'Failed to save tiles cache', details: error.message });
    }
});

// Проксирование запроса к внешнему источнику тайлов или получение из БД
// Этот эндпоинт теперь может служить для принудительного обновления кэша или получения сырых данных
app.get('/api/proxy/tile-info', async (req, res) => {
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
                     tilesObject[row.tile_id] = { id_tile: row.tile_id, ...JSON.parse(row.data) };
                 });
                 return res.status(200).json({ tiles: tilesObject, message: "External API failed, data from cache", from_cache: true });
             }
        } catch (cacheError) {
             console.error("❌ Ошибка при попытке получить данные из кэша как запасной вариант:", cacheError);
        }
        res.status(500).json({ error: 'Failed to fetch proxy tile info', details: error.message });
    }
});

// --- Общие эндпоинты ---

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'genesis-map-api'
  });
});

app.get('/test', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'API is working',
    timestamp: new Date().toISOString()
  });
});

// --- Запуск сервера ---

app.listen(port, async () => {
  console.log(`🚀 genesis-map-api server is running on port ${port}`);
  await initDatabase();
  await checkDatabaseConnection();
  
  // При запуске сервера можно проверить и обновить кэш, если он устарел
  console.log("🔍 Проверяем кэш тайлов при запуске...");
  const isStale = await isTileCacheStale();
  if (isStale) {
      console.log("🔄 Кэш устарел при запуске. Обновляем...");
      await refreshTileCache();
  } else {
      console.log("✅ Кэш тайлов актуален при запуске.");
  }
  
  console.log(`✅ genesis-map-api service started successfully`);
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
