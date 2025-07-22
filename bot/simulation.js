const fs = require('fs');

function getMockTile(tileId) {
  try {
    const raw = fs.readFileSync('./data/tiles_mock.json', 'utf-8');
    const data = JSON.parse(raw);
    return data[tileId] || null;
  } catch (err) {
    return null;
  }
}

function formatTile(tile, tileId) {
  if (!tile) return `❌ Тайл #${tileId} не найден в mock-данных`;
  return `🧪 Симуляция: тайл #${tileId}\n🔹 Название: ${tile.label}\n🔸 Редкость: ${tile.rarity}\n📍 Статус: ${tile.status}`;
}

module.exports = { getMockTile, formatTile };
