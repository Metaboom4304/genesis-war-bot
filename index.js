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

// Конфигурация
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://your-frontend-domain.com';
const EXTERNAL_TILE_API_URL = 'https://back.genesis-of-ages.space/manage/get_tile_info.php';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут
const MAX_TILES_PER_REQUEST = 2000; // Максимум тайлов за один запрос

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(compression({ level: 6 }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Слишком много запросов, попробуйте позже'
});
app.use('/api/', apiLimiter);

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept']
}));

app.use(express.json({ limit: '50mb' }));

// База данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Вспомогательные функции
async function initDatabase() {
  try {
    // Основная таблица тайлов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiles (
        id SERIAL PRIMARY KEY,
        tile_id INTEGER UNIQUE NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Индексы для быстрого поиска
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tiles_lng_lat 
      ON tiles(lng, lat);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tiles_tile_id 
      ON tiles(tile_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tiles_geom 
      ON tiles USING GIST (ST_MakePoint(lng, lat));
    `);

    console.log('✅ Database tables and indexes initialized');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

async function refreshTileCache() {
  console.log('🔄 Starting tile cache refresh...');
  
  try {
    const response = await fetch(EXTERNAL_TILE_API_URL, {
      timeout: 60000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Genesis-Map-API/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const tiles = data.tiles || data;
    
    if (!tiles || typeof tiles !== 'object') {
      throw new Error('Invalid tile data format');
    }

    const tileEntries = Object.entries(tiles);
    console.log(`📥 Fetched ${tileEntries.length} tiles from external API`);

    // Пакетная обработка для эффективности
    const batchSize = 1000;
    let processed = 0;

    for (let i = 0; i < tileEntries.length; i += batchSize) {
      const batch = tileEntries.slice(i, i + batchSize);
      const values = [];
      const valuePlaceholders = [];

      batch.forEach(([tileIdStr, tileData], index) => {
        const tileId = parseInt(tileIdStr);
        if (isNaN(tileId)) return;

        const lng = parseFloat(tileData.lng) || 0;
        const lat = parseFloat(tileData.lat) || 0;
        
        const baseIndex = index * 5;
        values.push(tileId, lng, lat, JSON.stringify(tileData), JSON.stringify(tileData));
        valuePlaceholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`);
      });

      if (values.length > 0) {
        const query = `
          INSERT INTO tiles (tile_id, lng, lat, data, updated_at)
          VALUES ${valuePlaceholders.join(', ')}
          ON CONFLICT (tile_id) 
          DO UPDATE SET 
            lng = EXCLUDED.lng,
            lat = EXCLUDED.lat,
            data = EXCLUDED.data,
            updated_at = NOW()
        `;

        await pool.query(query, values);
        processed += batch.length;
        console.log(`✅ Processed ${processed}/${tileEntries.length} tiles`);
      }
    }

    console.log(`🎉 Cache refresh completed: ${processed} tiles updated`);
    return true;
  } catch (error) {
    console.error('❌ Cache refresh failed:', error.message);
    return false;
  }
}

// API Endpoints
app.get('/api/tiles/bounds', async (req, res) => {
  try {
    const { west, south, east, north, zoom, limit = 1000 } = req.query;
    
    const bounds = {
      west: parseFloat(west),
      south: parseFloat(south),
      east: parseFloat(east),
      north: parseFloat(north),
      zoom: parseInt(zoom) || 1
    };

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

    const tiles = result.rows.map(row => ({
      id: row.tile_id,
      lng: row.lng,
      lat: row.lat,
      ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data)
    }));

    res.json({
      success: true,
      tiles,
      count: tiles.length,
      total: result.rowCount,
      bounds,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Bounds query error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tiles',
      message: error.message
    });
  }
});

app.get('/api/tiles/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM tiles');
    res.json({
      success: true,
      count: parseInt(result.rows[0].count),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cache/refresh', async (req, res) => {
  try {
    const success = await refreshTileCache();
    res.json({ 
      success, 
      message: success ? 'Cache refreshed successfully' : 'Cache refresh failed' 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health checks
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// Запуск сервера
app.listen(port, async () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌐 CORS enabled for: ${CORS_ORIGIN}`);
  
  await initDatabase();
  await refreshTileCache();
  
  // Автообновление кэша каждые 30 минут
  setInterval(refreshTileCache, CACHE_TTL_MS);
});

export default app;
