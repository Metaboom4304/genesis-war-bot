// ============================
// GENESIS_LAUNCHER.js (ESM) - Основной файл бота
// ============================
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath, pathToFileURL } from 'url';

// -----------------------------
// ENV проверка
// -----------------------------
const requiredEnv = ['TELEGRAM_TOKEN', 'API_URL'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`🔴 Missing ENV: ${key}`);
    process.exit(1);
  }
}

// -----------------------------
// Константы и пути
// -----------------------------
const TOKEN         = process.env.TELEGRAM_TOKEN;
const API_URL       = process.env.API_URL;
const BOT_PORT      = process.env.BOT_PORT || process.env.PORT || 10000;

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

// -----------------------------
// Express keep-alive
// -----------------------------
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'genesis-war-bot',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (_req, res) => res.send('🤖 GENESIS bot is alive!'));

app.listen(BOT_PORT, '0.0.0.0', () => console.log(`🌍 Express (keep-alive) listening on port ${BOT_PORT}`));
setInterval(() => console.log('💓 Bot heartbeat – still alive'), 60_000);

// -----------------------------
// Telegram Bot
// -----------------------------
const bot = new TelegramBot(TOKEN, { polling: true });

bot.getMe()
  .then(me => console.log(`✅ GENESIS bot active as @${me.username}`))
  .catch(console.error);

// -----------------------------
// Хранилище запросов аутентификации
// -----------------------------
const authRequests = new Map();

// -----------------------------
// Обработчики команд
// -----------------------------
// Обработчик команды /start с параметром auth_
bot.onText(/\/start\s+auth_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const requestId = match[1];
  
  // Проверяем, существует ли запрос
  if (!authRequests.has(requestId)) {
    return bot.sendMessage(chatId, '❌ Запрос на аутентификацию не найден или устарел. Попробуйте войти снова.');
  }
  
  const { expiresAt } = authRequests.get(requestId);
  
  // Проверяем срок действия запроса
  if (Date.now() > expiresAt) {
    authRequests.delete(requestId);
    return bot.sendMessage(chatId, '❌ Запрос на аутентификацию устарел. Попробуйте войти снова.');
  }
  
  const userId = msg.from.id;
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name || '';
  const username = msg.from.username || '';
  
  try {
    // Отправляем запрос на сервер для генерации токена
    const response = await fetch(`${API_URL}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: userId,
        first_name: firstName,
        last_name: lastName,
        username: username
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to generate token');
    }
    
    const { token } = await response.json();
    
    // Отправляем пользователю ссылку с токеном
    const siteUrl = 'https://genesis-data.onrender.com';
    const authUrl = `${siteUrl}?token=${token}&request_id=${requestId}`;
    
    const message = `
✅ Аутентификация подтверждена!

Перейдите на сайт для продолжения:
${authUrl}

Ссылка действительна 5 минут.
    `;
    
    await bot.sendMessage(
      chatId, 
      message,
      { 
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{
              text: 'Перейти к карте',
              url: authUrl
            }]
          ]
        }
      }
    );
    
    // Удаляем запрос из хранилища
    authRequests.delete(requestId);
  } catch (error) {
    console.error('Auth confirmation error:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при подтверждении аутентификации. Попробуйте позже.');
  }
});

// Обработчик команды /start без параметров
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  const message = `
🌍 Добро пожаловать в GENESIS WAR MAP!

Для доступа к карте требуется авторизация через Telegram.

Нажмите на кнопку ниже для входа:
  `;
  
  bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [{
          text: 'Войти через Telegram',
          callback_data: 'auth_request'
        }]
      ]
    }
  });
});

// Обработчик callback-запросов
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const uid = String(query.from.id);
  
  if (query.data === 'auth_request') {
    // Генерируем уникальный запрос
    const requestId = Math.random().toString(36).substr(2, 9);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 минут
    
    // Сохраняем запрос
    authRequests.set(requestId, { expiresAt });
    
    const message = `
✅ Запрос на аутентификацию создан!

Для завершения входа:
1. Нажмите на кнопку "Подтвердить вход" ниже
2. Система автоматически перенаправит вас на карту

Код действителен 5 минут.
    `;
    
    bot.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [{
            text: 'Подтвердить вход',
            callback_data: `confirm_auth_${requestId}`
          }]
        ]
      }
    });
    
    bot.answerCallbackQuery(query.id);
  } else if (query.data.startsWith('confirm_auth_')) {
    const requestId = query.data.replace('confirm_auth_', '');
    
    // Проверяем, существует ли запрос
    if (!authRequests.has(requestId)) {
      await bot.answerCallbackQuery(query.id, {
        text: 'Запрос не найден или устарел',
        show_alert: true
      });
      return;
    }
    
    const { expiresAt } = authRequests.get(requestId);
    
    // Проверяем срок действия запроса
    if (Date.now() > expiresAt) {
      authRequests.delete(requestId);
      await bot.answerCallbackQuery(query.id, {
        text: 'Запрос устарел, создайте новый',
        show_alert: true
      });
      return;
    }
    
    const userId = query.from.id;
    const firstName = query.from.first_name;
    const lastName = query.from.last_name || '';
    const username = query.from.username || '';
    
    try {
      // Отправляем запрос на сервер для генерации токена
      const response = await fetch(`${API_URL}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: userId,
          first_name: firstName,
          last_name: lastName,
          username: username
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate token');
      }
      
      const { token } = await response.json();
      
      // Отправляем пользователю ссылку с токеном
      const siteUrl = 'https://genesis-data.onrender.com';
      const authUrl = `${siteUrl}?token=${token}&request_id=${requestId}`;
      
      const message = `
✅ Аутентификация подтверждена!

Перейдите на сайт для продолжения:
${authUrl}

Ссылка действительна 5 минут.
      `;
      
      await bot.sendMessage(
        chatId, 
        message,
        { 
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{
                text: 'Перейти к карте',
                url: authUrl
              }]
            ]
          }
        }
      );
      
      // Удаляем запрос из хранилища
      authRequests.delete(requestId);
      
      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('Auth confirmation error:', error);
      await bot.answerCallbackQuery(query.id, {
        text: 'Ошибка при подтверждении аутентификации',
        show_alert: true
      });
    }
  }
});

// -----------------------------
// Graceful shutdown
// -----------------------------
async function cleanUp() {
  console.log('🛑 Received shutdown signal, stopping bot…');
  try {
    await bot.stopPolling();
    console.log('✅ Polling stopped.');
  } catch (err) {
    console.error('❌ Error during stopPolling:', err);
  }
  process.exit(0);
}
process.on('SIGINT', cleanUp);
process.on('SIGTERM', cleanUp);
