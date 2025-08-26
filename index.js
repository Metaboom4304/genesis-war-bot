// index.js - API Сервис (genesis-map-api)
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import 'dotenv/config'; // Убедитесь, что dotenv/config импортирован

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

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

    // Проверим также таблицы для меток и кэша, если они нужны
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

// Создаем таблицы, если они не существуют (на случай первого запуска)
// ВАЖНО: Убедитесь, что структура таблиц соответствует вашим данным.
async function initDatabase() {
  try {
    // Таблица пользователей
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

    // Таблица пользовательских меток (примерная структура)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_marks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        tile_id INTEGER NOT NULL,
        mark_type TEXT NOT NULL, -- 'ally', 'enemy', 'favorite', 'clear'
        comment TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, tile_id, mark_type) -- Предотвращает дублирование одного типа метки на тайл для пользователя
      );
    `);

    // Таблица кэша тайлов (примерная структура)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiles_caches (
        -- Можно использовать составной ключ или отдельный id
        -- Для простоты предположим, что tile_id уникален
        tile_id INTEGER PRIMARY KEY,
        data JSONB, -- Храним всю информацию о тайле в JSON
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Error initializing database tables:', error);
  }
}

// --- API Эндпоинты ---

// --- Эндпоинты для пользователей ---

// Регистрация пользователя в базе данных (основной эндпоинт)
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

// Регистрация пользователя в базе данных (альтернативный эндпоинт для фронтенда)
// Фронтенд ожидает этот путь: POST /api/users/register
app.post('/api/users/register', async (req, res) => {
  // Просто вызываем основную функцию регистрации
  return app._router.handle({ method: 'POST', url: '/register', body: req.body }, res);
  // Альтернатива: скопировать логику, если нужно что-то изменить
  /*
  try {
    // ... (повторить логику из /register)
  } catch (error) {
    // ... (обработка ошибок)
  }
  */
});

// Эндпоинт для получения всех пользователей (для рассылки)
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

// Эндпоинт для получения информации о пользователе по ID
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

// Эндпоинт для уведомлений (пример)
app.post('/notify', async (req, res) => {
  try {
    const { user_id, tile_id, action, comment } = req.body;
    console.log(`Notification: User ${user_id} performed ${action} on tile ${tile_id} with comment: ${comment}`);
    // Здесь можно добавить логику обработки уведомления, например, запись в БД или отправку сообщения через бот
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error processing notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Эндпоинты для данных карты ---

// Получение меток пользователя
// Фронтенд ожидает этот путь: GET /api/marks/:userId
app.get('/api/marks/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        // Логика получения меток для пользователя userId из таблицы user_marks
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
// Фронтенд ожидает этот путь: POST /api/marks
app.post('/api/marks', async (req, res) => {
    const { user_id, tile_id, mark_type, comment } = req.body;
    
    // Базовая валидация
    if (!user_id || !tile_id || !mark_type) {
       return res.status(400).json({ error: 'Missing required fields: user_id, tile_id, mark_type' });
    }

    try {
        let query, values;
        if (mark_type === 'clear') {
            // Удаление метки
            query = 'DELETE FROM user_marks WHERE user_id = $1 AND tile_id = $2';
            values = [user_id, tile_id];
        } else {
            // Вставка или обновление метки
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
             // Если удалять было нечего, это тоже успех
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
// Фронтенд ожидает этот путь: GET /api/tiles-cache
app.get('/api/tiles-cache', async (req, res) => {
    try {
        // Логика получения кэшированной информации о тайлах из таблицы tiles_caches
        // Возвращаем данные в формате, который ожидает фронтенд
        const result = await pool.query('SELECT tile_id AS id_tile, data FROM tiles_caches');
        
        // Преобразуем результат в объект, где ключи - id_tile
        const tilesObject = {};
        result.rows.forEach(row => {
            // Предполагаем, что data содержит всю необходимую информацию о тайле
            tilesObject[row.id_tile] = { id_tile: row.id_tile, ...row.data };
        });

        res.status(200).json({ tiles: tilesObject });
    } catch (error) {
        console.error('Error fetching tiles cache:', error);
        // В случае ошибки БД можно вернуть пустой объект или тестовые данные
        res.status(200).json({ tiles: {} }); // Или res.status(500).json({ error: 'Failed to fetch tiles cache' });
    }
});

// Сохранение кэша тайлов (если фронтенд или другой сервис его обновляет)
// Фронтенд может ожидать этот путь: POST /api/tiles-cache
app.post('/api/tiles-cache', async (req, res) => {
    // req.body должно содержать данные для кэширования, например { tilesResponse }
    const { tilesResponse } = req.body; // Адаптируйте под структуру данных из фронтенда
    
    if (!tilesResponse || !tilesResponse.tiles) {
        return res.status(400).json({ error: 'Invalid data format for tiles cache' });
    }

    try {
        // Начинаем транзакцию для атомарности операций
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Очищаем старый кэш (опционально)
            // await client.query('DELETE FROM tiles_caches');
            
            // Вставляем/обновляем новые данные
            for (const [tileId, tileData] of Object.entries(tilesResponse.tiles)) {
                await client.query(
                    `
                    INSERT INTO tiles_caches (tile_id, data, last_updated)
                    VALUES ($1, $2, CURRENT_TIMESTAMP)
                    ON CONFLICT (tile_id)
                    DO UPDATE SET data = EXCLUDED.data, last_updated = CURRENT_TIMESTAMP;
                    `,
                    [tileId, JSON.stringify(tileData)] // Сохраняем данные как JSON
                );
            }
            
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Tiles cache updated' });
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
// Фронтенд ожидает этот путь: GET /api/proxy/tile-info
app.get('/api/proxy/tile-info', async (req, res) => {
    // Логика проксирования запроса к внешнему источнику тайлов
    // или получения информации из локальной БД
    try {
        // TODO: Реализуйте логику получения данных о тайлах.
        // Это может быть:
        // 1. Запрос к внешнему API (например, https://back.genesis-of-ages.space/manage/get_tile_info.php)
        // 2. Чтение из таблицы tiles_caches
        // 3. Чтение из другой таблицы в БД Neon
        
        // Пример заглушки - возвращаем пустой объект
        // В реальности здесь должен быть код для получения данных
        console.warn('GET /api/proxy/tile-info is a stub. Implement real data fetching logic.');
        res.status(200).json({ tiles: {} });
        
        // Пример реализации с запросом к внешнему API (нужно установить axios или node-fetch)
        /*
        const axios = require('axios'); // Установите: npm install axios
        try {
            const response = await axios.get('https://back.genesis-of-ages.space/manage/get_tile_info.php');
            // Обработка и форматирование данных response.data
            res.status(200).json(response.data);
        } catch (apiError) {
            console.error('Error fetching from external tile API:', apiError.message);
            res.status(500).json({ error: 'Failed to fetch tile info from external source' });
        }
        */
        
    } catch (error) {
        console.error('Error in /api/proxy/tile-info:', error);
        res.status(500).json({ error: 'Failed to fetch proxy tile info' });
    }
});

// --- Общие эндпоинты ---

// Эндпоинт для здоровья приложения
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'genesis-map-api'
  });
});

// Простой тестовый эндпоинт
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

export default app; // Необязательно для запуска, но полезно если будет импортироваться
