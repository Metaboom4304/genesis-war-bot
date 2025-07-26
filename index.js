const TelegramBot = require('node-telegram-bot-api');
const { logAccess, checkRole, getRoleById } = require('./utils.js'); 
const { handleStart, handleDevPanel, handleDebug } = require('./logic.js'); 

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  await logAccess(chatId, 'start');
  await handleStart(bot, msg);
});

bot.onText(/^\/devpanel$/, async (msg) => {
  const chatId = msg.chat.id;
  const role = await getRoleById(chatId);
  if (checkRole(role, 'dev')) {
    await logAccess(chatId, 'devpanel');
    await handleDevPanel(bot, msg);
  } else {
    bot.sendMessage(chatId, '⛔️ Нет доступа к /devpanel');
  }
});

bot.onText(/^\/debug$/, async (msg) => {
  const chatId = msg.chat.id;
  const role = await getRoleById(chatId);
  if (checkRole(role, 'admin') || checkRole(role, 'dev')) {
    await logAccess(chatId, 'debug');
    await handleDebug(bot, msg);
  } else {
    bot.sendMessage(chatId, '⛔️ Отказано в доступе к /debug');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  await logAccess(chatId, `callback: ${data}`);
  // Тут можно добавить inline-команды, типа кнопок devMode / mapToggle
});

bot.on('message', (msg) => {
  // Для всех остальных сообщений — можно добавить логирование
});
