// ReplyKeyboard для обычного пользователя
function getUserKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['📦 Обновления', '🗺 Дорожная карта'],
        ['🧪 Симуляция тайла'],
        ['🌐 Открыть карту']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// ReplyKeyboard для администратора
function getAdminKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['📦 Обновления', '🗺 Дорожная карта'],
        ['🧪 Симуляция тайла', '📢 Рассылка'],
        ['🔧 DevPanel', '📂 Управление тайлами'],
        ['🌐 Открыть карту', '📄 Логи карты']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

module.exports = { getUserKeyboard, getAdminKeyboard };
