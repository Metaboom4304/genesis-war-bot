// ╔══════════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control   ║
// ╚══════════════════════════════════════════╝

const fs            = require('fs')
const path          = require('path')
const TelegramBot   = require('node-telegram-bot-api')

// ╔══════════════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: Защита инженерной среды        ║
// ╚══════════════════════════════════════════════╝
const requiredEnv = ['TELEGRAM_TOKEN', 'ADMIN_ID']
let   envValid    = true

console.log('\n🧭 Инициализация GENESIS_LAUNCHER...')
for (const key of requiredEnv) {
  const val = process.env[key]
  if (!val) {
    console.log(`🔴 ENV отсутствует: ${key}`)
    envValid = false
  } else {
    console.log(`🟢 ${key} активен: ${val.slice(0,6)}...`)
  }
}
if (!envValid) {
  console.log('\n⛔️ Остановка: задайте все ENV-переменные')
  process.exit(1)
}

const TOKEN    = process.env.TELEGRAM_TOKEN
const ADMIN_ID = String(process.env.ADMIN_ID)

// ╔══════════════════════════════════════════╗
// ║ 📂 Пути к файлам и каталогу памяти      ║
// ╚══════════════════════════════════════════╝
const memoryPath = path.join(__dirname, 'memory')
const usersPath  = path.join(__dirname, 'users.json')
const lockPath   = path.join(memoryPath, 'botEnabled.lock')

// ┌──────────────────────────────────────────┐
// │ 📁 Проверка и создание окружения        │
// └──────────────────────────────────────────┘
if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath)
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath, JSON.stringify({}, null, 2))
if (!fs.existsSync(lockPath))  fs.writeFileSync(lockPath, 'enabled')

// ╔══════════════════════════════════╗
// ║ 🛠️ Флаги работы бота             ║
// ╚══════════════════════════════════╝
function isBotEnabled()    { return fs.existsSync(lockPath) }
function activateBotFlag() { fs.writeFileSync(lockPath, 'enabled') }
function deactivateBotFlag(){
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath)
}

// ╔══════════════════════════════════════╗
// ║ 🧾 Работа с users.json                ║
// ╚══════════════════════════════════════╝
function registerUser(userId) {
  userId = String(userId)
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    if (!users[userId]) {
      users[userId] = { registered: true, ts: Date.now() }
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
      console.log(`👤 Зарегистрирован: ${userId}`)
    }
  } catch (err) {
    console.error('❌ Ошибка записи users.json:', err)
  }
}

function isRegistered(userId) {
  userId = String(userId)
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    return Boolean(users[userId])
  } catch {
    return false
  }
}

function getUserCount() {
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    return Object.keys(users).length
  } catch {
    return 0
  }
}

// ╔══════════════════════════════════╗
// ║ 📣 Рассылка и логика broadcast    ║
// ╚══════════════════════════════════╝
async function broadcastAll(bot, message) {
  let users = {}
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
  } catch {}
  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, `📣 Объявление:\n${message}`)
    } catch (err) {
      console.error(`⚠️ Не удалось отправить ${uid}:`, err.response?.body || err)
      if (err.response?.statusCode === 403) {
        delete users[uid]
        console.log(`🗑 Удалён заблокировавший бот пользователь: ${uid}`)
      }
    }
  }
  try {
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
  } catch {}
}

// ╔════════════════════════════════════╗
// ║ 📋 Reply-клавиатура снизу          ║
// ╚════════════════════════════════════╝
function sendReplyMenu(bot, chatId, uid, text = '📋 Меню доступно снизу:') {
  uid = String(uid)
  const isAdmin = uid === ADMIN_ID

  const userMenu = {
    reply_markup: {
      keyboard: [
        ['🧾 Info', '🛣️ Roadmap'],
        ['🌐 Ссылки', '🗺️ Карта'],
        ['❓ Помощь']
      ],
      resize_keyboard: true
    }
  }

  const adminMenu = {
    reply_markup: {
      keyboard: [
        ['🧾 Info', '🛣️ Roadmap'],
        ['🌐 Ссылки', '🗺️ Карта'],
        ['❓ Помощь'],
        ['📢 Рассылка', '📃 Логи'],
        ['🟢 Включить карту', '⚠️ Выключить карту'],
        ['👥 Добавить админа', '📑 Список админов']
      ],
      resize_keyboard: true
    }
  }

  const menu = isAdmin ? adminMenu : userMenu
  bot.sendMessage(chatId, text, menu).catch(console.error)
}

// ╔══════════════════════════════════════╗
// ║ 🤖 Инициализация и запуск Bot       ║
// ╚══════════════════════════════════════╝
activateBotFlag()
const bot     = new TelegramBot(TOKEN, { polling: true })
let   launched = false

bot.on('error', err =>
  console.error('💥 Telegram API error:', err.code, err.response?.body || err)
)
bot.on('polling_error', err =>
  console.error('📡 Polling error:', err.code, err.response?.body || err)
)

// простой логер входящих сообщений
bot.on('message', msg => {
  console.log(`📨 [${msg.chat.id}] ${msg.from.username || 'unknown'}: ${msg.text}`)
})

bot.getMe().then(me => {
  console.log(`✅ GENESIS активен как @${me.username}`)
  launched = true
})

// ╔═══════════════════════════════════╗
// ║ ⚙️ Стандартные команды            ║
// ╚═══════════════════════════════════╝

// /start — регистрация + reply-меню
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id
  const uid    = msg.from.id

  registerUser(uid)
  sendReplyMenu(bot,
    chatId,
    uid,
    '🚀 Добро пожаловать! Вы успешно зарегистрированы.'
  )
})

// /help — текст + reply-меню
bot.onText(/\/help/, msg => {
  sendReplyMenu(bot,
    msg.chat.id,
    msg.from.id,
    '📖 Команды:\n' +
    '/start — регистрация + меню\n' +
    '/status — состояние бота\n' +
    '/menu — меню снизу\n' +
    '/poweroff, /poweron, /restart — админ'
  )
})

// /status — без кнопок
bot.onText(/\/status/, msg => {
  bot.sendMessage(msg.chat.id,
    `📊 Статус:\n` +
    `- Запущен: ${launched}\n` +
    `- Активен: ${isBotEnabled()}\n` +
    `- Юзеров: ${getUserCount()}`
  ).catch(console.error)
})

// /menu — просто reply-меню
bot.onText(/\/menu/, msg => {
  sendReplyMenu(bot, msg.chat.id, msg.from.id)
})

// power commands — админ
bot.onText(/\/poweroff/, msg => {
  if (String(msg.from.id) === ADMIN_ID) {
    deactivateBotFlag()
    bot.sendMessage(msg.chat.id, '🛑 Бот остановлен.')
      .then(() => process.exit(0))
      .catch(console.error)
  }
})

bot.onText(/\/poweron/, msg => {
  if (String(msg.from.id) === ADMIN_ID) {
    if (!isBotEnabled()) {
      activateBotFlag()
      bot.sendMessage(msg.chat.id, '✅ Бот включён. Перезапустите.').catch(console.error)
    } else {
      bot.sendMessage(msg.chat.id, '⚠️ Уже активен.').catch(console.error)
    }
  }
})

bot.onText(/\/restart/, msg => {
  if (String(msg.from.id) === ADMIN_ID) {
    deactivateBotFlag()
    activateBotFlag()
    bot.sendMessage(msg.chat.id, '🔄 Перезапуск…')
      .then(() => process.exit(0))
      .catch(console.error)
  }
})

// ╔══════════════════════════════════╗
// ║ 🔲 Обработка текстовых кнопок     ║
// ╚══════════════════════════════════╝
const broadcastPending = new Set()
const disablePending   = new Set()

bot.on('message', msg => {
  const text   = msg.text
  const chatId = msg.chat.id
  const uid    = String(msg.from.id)

  // —————————————————————————————
  //  Ответ на broadcast: force_reply
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text.includes('Напишите текст для рассылки')
  ) {
    broadcastPending.delete(uid)
    broadcastAll(bot, text)
      .then(() => bot.sendMessage(uid, '✅ Рассылка выполнена.'))
      .catch(console.error)
    return
  }

  // —————————————————————————————
  //  Подтверждение выключения карты
  if (
    disablePending.has(uid) &&
    msg.reply_to_message?.text.includes('Подтвердите отключение карты')
  ) {
    disablePending.delete(uid)
    deactivateBotFlag()
    bot.sendMessage(chatId, '🛑 Карта отключена. Пользователи уведомлены.')
      .then(() => broadcastAll(bot,
        '⛔ Карта временно отключена для техработ.\nСкоро вернёмся!'
      ))
      .catch(console.error)
    return
  }

  // —————————————————————————————
  //  Обработка reply-кнопок
  switch (text) {
    // обычные
    case '🧾 Info':
      bot.sendMessage(chatId, '🧾 Версия: 1.0.0\n👨‍💻 Авторы: GENESIS')
      break
    case '🛣️ Roadmap':
      bot.sendMessage(chatId,
        '🛣️ Roadmap:\n1. Запуск\n2. Обновления\n3. Новые фичи'
      )
      break
    case '🌐 Ссылки':
      bot.sendMessage(chatId, '🌐 Сайт: https://example.com')
      break
    case '🗺️ Карта':
      bot.sendMessage(chatId,
        '🌍 Карта: https://metaboom4304.github.io/genesis-data/'
      )
      break
    case '❓ Помощь':
      bot.sendMessage(chatId,
        '📖 Помощь:\n' +
        '- /start — регистрация\n' +
        '- /status — состояние\n' +
        '- /menu — меню снизу'
      )
      break

    // админские
    case '📢 Рассылка':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid)
        bot.sendMessage(chatId,
          '✏️ Напишите текст для рассылки:',
          { reply_markup: { force_reply: true } }
        ).catch(console.error)
      }
      break
    case '📃 Логи':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '📄 Логи: тайлов 344/500, ошибок 0')
      }
      break
    case '🟢 Включить карту':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '🟢 Карта включена.')
      }
      break
    case '⚠️ Выключить карту':
      if (uid === ADMIN_ID) {
        disablePending.add(uid)
        bot.sendMessage(chatId,
          '⚠️ Подтвердите отключение карты:',
          { reply_markup: { force_reply: true } }
        ).catch(console.error)
      }
      break
    case '👥 Добавить админа':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, '👥 Назначение админа в разработке.')
      }
      break
    case '📑 Список админов':
      if (uid === ADMIN_ID) {
        bot.sendMessage(chatId, `📑 Админы: ${ADMIN_ID}`)
      }
      break
  }
})

// ╔══════════════════════════════════════════╗
// ║ 📨 Обработка ответов (интерактивных)      ║
// ╚══════════════════════════════════════════╝
// (broadcast и выключение карты обрабатываются выше)

module.exports = bot
