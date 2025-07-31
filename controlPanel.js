// ╔════════════════════════════════════════╗
// ║ 🕹️ controlPanel.js — Меню с кнопками   ║
// ╚════════════════════════════════════════╝

const fs = require('fs');
const { ADMIN_ID } = process.env;

// 👉 Функция для показа меню пользователю
function sendUserMenu(bot, chatId) {
  const userMenu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Старт', callback_data: 'start' }],
        [{ text: '🗺️ Карта', callback_data: 'map' }],
        [{ text: '❓ Помощь', callback_data: 'help' }],
        [{ text: 'ℹ️ Инфо', callback_data: 'info' }],
        [{ text: '🛣️ Roadmap', callback_data: 'roadmap' }],
        [{ text: '🌐 Оф. Ссылки', callback_data: 'links' }]
      ]
    }
  };
  bot.sendMessage(chatId, '📋 Меню пользователя:', userMenu);
}

// 👉 Функция для показа меню админа (если ID совпадает)
function sendAdminMenu(bot, chatId, userId) {
  if (userId != ADMIN_ID) return;

  const adminMenu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📄 Логи карты', callback_data: 'logs' }],
        [
          { text: '🟢 Включить карту', callback_data: 'map_enable' },
          { text: '🔴 Выключить карту', callback_data: 'map_disable_confirm' }
        ],
        [{ text: '👑 Админы', callback_data: 'admins' }],
        [
          { text: '👤 Назначить админа', callback_data: 'add_admin' },
          { text: '📃 Список админов', callback_data: 'list_admins' }
        ],
        [{ text: '📣 Рассылка', callback_data: 'broadcast' }]
      ]
    }
  };
  bot.sendMessage(chatId, '🔐 Панель администратора:', adminMenu);
}

module.exports = { sendUserMenu, sendAdminMenu };
