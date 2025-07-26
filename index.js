// index.js

// Подгружаем .env и распаковываем BOT_TOKEN
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import App from './controllers/index.js';

// debug: убеждаемся, что токен читается
console.log('[INIT] BOT_TOKEN =', process.env.BOT_TOKEN);
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN отсутствует! Завершаем работу.');
  process.exit(1);
}

// создаём экземпляр бота с polling
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// проверяем токен методом getMe
bot.getMe()
  .then(me => {
    console.log('[INIT] Авторизован как @' + me.username);
  })
  .catch(err => {
    console.error('❌ Не удалось авторизоваться (getMe):', err.response?.body || err.message);
    process.exit(1);
  });

// логируем ошибки polling-а
bot.on('polling_error', error => {
  console.error('❌ Polling error:', error.code, error.response?.body || error);
});

// универсальный приёмник любых сообщений
bot.on('message', msg => {
  try {
    App.handleMessage(bot, msg);
  } catch (err) {
    console.error('❌ Ошибка в App.handleMessage:', err);
  }
});

// команда /start
bot.onText(/\/start/, msg => {
  try {
    App.start(bot, msg);
  } catch (err) {
    console.error('❌ Ошибка в App.start:', err);
  }
});

// команда /help
bot.onText(/\/help/, msg => {
  try {
    App.help(bot, msg);
  } catch (err) {
    console.error('❌ Ошибка в App.help:', err);
  }
});

// inline-запросы
bot.on('inline_query', query => {
  try {
    App.handleInlineQuery(bot, query);
  } catch (err) {
    console.error('❌ Ошибка в App.handleInlineQuery:', err);
  }
});

// выбор inline результата
bot.on('chosen_inline_result', result => {
  try {
    App.handleChosenInlineResult(bot, result);
  } catch (err) {
    console.error('❌ Ошибка в App.handleChosenInlineResult:', err);
  }
});

// колбэки из кнопок
bot.on('callback_query', callbackQuery => {
  try {
    App.handleCallbackQuery(bot, callbackQuery);
  } catch (err) {
    console.error('❌ Ошибка в App.handleCallbackQuery:', err);
  }
});

export default bot;
