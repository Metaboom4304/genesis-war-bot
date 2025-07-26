// index.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const bodyParser  = require('body-parser');
const winston     = require('winston');
const App         = require('./controllers/index.js');

// Логгер
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Проверяем токен
const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  logger.error('TELEGRAM_TOKEN не задан');
  process.exit(1);
}

// Инициализируем бота
const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', (err) => logger.error('Polling error:', err));

// Подключаем контроллеры
App(bot);

// Dev-панель
const app = express();
app.use(bodyParser.json());

app.get('/',    (req, res) => res.send('🛠 Bot is running.'));
app.get('/status', (req, res) => {
  res.json({ status: 'up', uptime: process.uptime() });
});
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Dev-панель на http://localhost:${PORT}`));

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  bot.stopPolling();
  process.exit(0);
});
