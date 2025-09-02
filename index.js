// index.js - Оптимизированный API для 65,000+ тайлов
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
// ВАЖНО: Убраны пробелы в конце строк
const CORS_ORIGIN = 'https://genesis-data.onrender.com'; // Исправлено: пробелы убраны
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php'; // Исправлено: пробелы убраны
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут
const MAX_TILES_PER_REQUEST = 2000; // Максимум тайлов за один запрос

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Сжатие ответов для уменьшения трафика
app.use(compression({ level: 6 }));

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
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept']
}));

// Парсинг JSON в теле запроса
app.use(express.json({ limit: '50mb' }));

// --- Подключение к базе данных PostgreSQL (Neon) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Максимальное количество клиентов в пуле
  idleTimeoutMillis: 30000, // Время простоя перед закрытием клиента (30 сек)
  connectionTimeoutMillis: 10000, // Время ожидания подключения (10 сек)
  // В продакшене требуется SSL
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- Вспомогательные функции ---

/**
 * Инициализирует структуру базы данных: создает таблицы и индексы, если их еще нет.
 */
async function initDatabase() {
  try {
    console.log('🔧 Инициализация структуры базы данных...');

    // Таблица пользователей Telegram
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        language_code TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Таблица пользовательских меток на тайлах
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_marks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        tile_id INTEGER NOT NULL,
        mark_type TEXT NOT NULL, -- 'ally', 'enemy', 'favorite'
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        -- Уникальное ограничение предотвращает дубликаты
        UNIQUE(user_id, tile_id, mark_type) 
      );
    `);

    // Основная таблица кэшированных данных тайлов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiles (
        id SERIAL PRIMARY KEY,
        tile_id INTEGER UNIQUE NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        data JSONB NOT NULL, -- Полные данные тайла в формате JSON
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Индексы для ускорения поиска
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tiles_lng_lat ON tiles(lng, lat);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tiles_tile_id ON tiles(tile_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_marks_user_id ON user_marks(user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_marks_tile_id ON user_marks(tile_id);`);

    console.log('✅ Структура базы данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
  }
}

/**
 * Обновляет локальный кэш тайлов, загружая данные с внешнего API.
 * @returns {Promise<boolean>} true, если обновление прошло успешно, иначе false.
 */
async function refreshTileCache() {
  console.log('🔄 Начало обновления кэша тайлов...');
  
  try {
    // --- 1. Загрузка данных с внешнего сервера ---
    console.log(`📥 Запрос данных у внешнего API: ${EXTERNAL_TILE_API_URL}`);
    const response = await fetch(EXTERNAL_TILE_API_URL, {
      timeout: 60000, // Таймаут 60 секунд
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Genesis-Map-API/1.0'
      }
    });

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
      const values = []; // Плоский массив значений для placeholder'ов
      const valuePlaceholders = []; // Массив строк placeholder'ов для SQL

      batch.forEach(([tileIdStr, tileData], index) => {
        const tileId = parseInt(tileIdStr, 10);
        if (isNaN(tileId)) {
            console.warn(`⚠️ Пропущен тайл с некорректным ID: ${tileIdStr}`);
            return;
        }

        const lng = parseFloat(tileData.lng) || 0;
        const lat = parseFloat(tileData.lat) || 0;
        
        // Рассчитываем смещение для placeholder'ов в этом пакете
        // У нас 4 значения на запись: tile_id, lng, lat, data
        const baseIndex = index * 4; 
        
        // Добавляем значения в плоский массив
        values.push(tileId, lng, lat, JSON.stringify(tileData));
        
        // Создаем строку placeholder'ов для этой записи
        // Пример: ($1, $2, $3, $4)
        valuePlaceholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`);
      });

      // Если в пакете есть корректные данные, выполняем запрос
      if (values.length > 0) {
        // Формируем SQL-запрос для пакетной вставки
        const query = `
          INSERT INTO tiles (tile_id, lng, lat, data)
          VALUES ${valuePlaceholders.join(', ')}
          ON CONFLICT (tile_id) 
          DO UPDATE SET 
            lng = EXCLUDED.lng,
            lat = EXCLUDED.lat,
            data = EXCLUDED.data,
            updated_at = NOW() -- Обновляем время изменения
        `;

        // Выполняем запрос с подготовленными значениями
        await pool.query(query, values);
        processed += batch.length;
        console.log(`✅ Обработано ${processed}/${tileEntries.length} тайлов`);
      }
    }

    console.log(`🎉 Обновление кэша завершено: ${processed} тайлов обновлено`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка обновления кэша:', error.message);
    // Не останавливаем сервер, просто сообщаем об ошибке
    return false; 
  }
}

// --- API Endpoints ---

/**
 * POST /api/users/register
 * Регистрирует или обновляет информацию о пользователе Telegram.
 */
app.post('/api/users/register', async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language_code } = req.body;

    // Базовая валидация
    if (!telegram_id || !first_name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Отсутствуют обязательные поля: telegram_id и first_name' 
      });
    }

    const query = `
      INSERT INTO users (telegram_id, first_name, last_name, username, language_code)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        language_code = EXCLUDED.language_code,
        updated_at = NOW()
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
    res.status(200).json({ success: true, user: result.rows[0] });
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
    const userId = req.params.userId;
    const result = await pool.query(
      'SELECT tile_id, mark_type, comment FROM user_marks WHERE user_id = $1', 
      [userId]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(`Ошибка получения меток для пользователя ${userId}:`, error);
    res.status(500).json({ error: 'Не удалось получить метки' });
  }
});

/**
 * POST /api/marks
 * Создает, обновляет или удаляет метку пользователя на тайле.
 */
app.post('/api/marks', async (req, res) => {
  try {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    // Валидация
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ 
        success: false,
        error: 'Отсутствуют обязательные поля: user_id, tile_id, mark_type' 
       });
    }

    let query, values, result;

    if (mark_type === 'clear') {
        // Удаление метки
        query = 'DELETE FROM user_marks WHERE user_id = $1 AND tile_id = $2';
        values = [user_id, tile_id];
        result = await pool.query(query, values);
        res.status(200).json({ 
          success: true, 
          message: result.rowCount > 0 ? 'Метка удалена' : 'Метка не найдена для удаления' 
        });
    } else {
        // Создание или обновление метки
        query = `
            INSERT INTO user_marks (user_id, tile_id, mark_type, comment)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, tile_id, mark_type)
            DO UPDATE SET 
              comment = EXCLUDED.comment, 
              created_at = NOW() -- Обновляем время создания/изменения
            RETURNING *;
        `;
        values = [user_id, tile_id, mark_type, comment || null];
        result = await pool.query(query, values);
        res.status(200).json({ success: true, mark: result.rows[0] });
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
    const { west, south, east, north, limit = 1000 } = req.query;
    
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

    const query = `
      SELECT tile_id, lng, lat, data
      FROM tiles 
      WHERE lng BETWEEN $1 AND $2 
        AND lat BETWEEN $3 AND $4
      LIMIT $5
    `;

    const result = await pool.query(query, [
      bounds.west, bounds.east, 
      bounds.south, bounds.north,
      queryLimit
    ]);

    // Преобразуем данные из БД в удобный формат
    const tiles = result.rows.map(row => ({
      id: row.tile_id,
      lng: row.lng,
      lat: row.lat,
      // Если data - строка JSON, парсим её, иначе используем как есть
      ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data)
    }));

    res.json({
      success: true,
      tiles,
      count: tiles.length,
      bounds,
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
 * POST /api/cache/refresh (Для ручного обновления, если нужно)
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
});

export default app;
