// ╔════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control ║
// ╚════════════════════════════════════╝
const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const { Octokit } = require('@octokit/rest')

// ╔════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: Защита инженерной среды ║
// ╚════════════════════════════════════╝
const requiredEnv = [
  'TELEGRAM_TOKEN',
  'ADMIN_ID',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO'
]
let envValid = true
console.log('\n🧑‍🔧 Инициализация GENESIS_LAUNCHER...')
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
  console.log('\n⛔ Задайте все ENV-переменные и перезапустите.')
  process.exit(1)
}

const TOKEN         = process.env.TELEGRAM_TOKEN
const ADMIN_ID      = String(process.env.ADMIN_ID)
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN
const GITHUB_OWNER  = process.env.GITHUB_OWNER
const GITHUB_REPO   = process.env.GITHUB_REPO
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'
const octokit       = new Octokit({ auth: GITHUB_TOKEN })

// ╔════════════════════════════════════╗
// ║ 📂 Локальное хранилище и файлы     ║
// ╚════════════════════════════════════╝
const memoryPath = path.join(__dirname, 'memory')
const usersPath  = path.join(__dirname, 'users.json')
const lockPath   = path.join(memoryPath, 'botEnabled.lock')

// создаём папки и файлы если надо
if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath)
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath,  JSON.stringify({},null,2))
if (!fs.existsSync(lockPath))  fs.writeFileSync(lockPath,   'enabled')

// ╔════════════════════════════════════╗
// ║ 🛠️ Флаги работы бота               ║
// ╚════════════════════════════════════╝
function isBotEnabled()     { return fs.existsSync(lockPath) }
function activateBotFlag()  { fs.writeFileSync(lockPath, 'enabled') }
function deactivateBotFlag(){ if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath) }

// ╔════════════════════════════════════╗
// ║ 🤖 Работа с юзерами                ║
// ╚════════════════════════════════════╝
function registerUser(userId) {
  userId = String(userId)
  try {
    const users = JSON.parse(fs.readFileSync(usersPath,'utf8'))
    if (!users[userId]) {
      users[userId] = { registered: true, ts: Date.now() }
      fs.writeFileSync(usersPath, JSON.stringify(users,null,2))
      console.log(`👤 Зарегистрирован: ${userId}`)
    }
  } catch(err) {
    console.error('❌ Ошибка записи users.json:', err)
  }
}
function getUserCount() {
  try {
    const users = JSON.parse(fs.readFileSync(usersPath,'utf8'))
    return Object.keys(users).length
  } catch {
    return 0
  }
}

// ╔════════════════════════════════════╗
// ║ 📣 Broadcast & GitHub API          ║
// ╚════════════════════════════════════╝
async function broadcastAll(bot, message) {
  let users = {}
  try { users = JSON.parse(fs.readFileSync(usersPath,'utf8')) } catch{}
  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, message)
    } catch(err) {
      console.error(`⚠️ Не отправить ${uid}:`, err.response?.body||err)
      if (err.response?.statusCode === 403) {
        delete users[uid]
        console.log(`🗑 Удалён пользователь ${uid}`)
      }
    }
  }
  try { fs.writeFileSync(usersPath, JSON.stringify(users,null,2)) } catch{}
}

async function fetchMapStatus() {
  const res = await octokit.repos.getContent({
    owner: GITHUB_OWNER, repo: GITHUB_REPO,
    path: 'map-status.json', ref: GITHUB_BRANCH
  })
  const raw = Buffer.from(res.data.content,'base64').toString()
  return { sha: res.data.sha, status: JSON.parse(raw) }
}
async function updateMapStatus({ enabled, message, theme='auto', disableUntil }) {
  const { sha } = await fetchMapStatus()
  const newStatus = { enabled, message, theme, disableUntil }
  const content   = Buffer.from(JSON.stringify(newStatus,null,2)).toString('base64')
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER, repo: GITHUB_REPO,
    path: 'map-status.json',
    message: `🔄 Update map-status: enabled=${enabled}`,
    content, sha, branch: GITHUB_BRANCH
  })
}

// ╔════════════════════════════════════╗
// ║ 📋 Reply-меню                      ║
// ╚════════════════════════════════════╝
function sendReplyMenu(bot, chatId, uid, text = '📋 Меню доступно снизу:') {
  uid = String(uid)
  const isAdmin = uid === ADMIN_ID
  const userMenu = {
    reply_markup: {
      keyboard: [
        ['🤖 Info','🗺️ Карта'],
        ['🔍 Ссылки','❓ Помощь']
      ],
      resize_keyboard: true
    }
  }
  const adminMenu = {
    reply_markup: {
      keyboard: [
        ['🤖 Info','🗺️ Карта'],
        ['🔍 Ссылки','❓ Помощь'],
        ['📢 Рассылка','📄 Логи'],
        ['⚠️ Выключить карту','✅ Включить карту'],
        ['👤 Добавить админа','📑 Список админов']
      ],
      resize_keyboard: true
    }
  }
  const menu = isAdmin ? adminMenu : userMenu
  bot.sendMessage(chatId, text, menu).catch(console.error)
}

// ╔════════════════════════════════════╗
// ║ 🤖 Инициализация и запуск бота     ║
// ╚════════════════════════════════════╝
activateBotFlag()
const bot = new TelegramBot(TOKEN, { polling: true })
let launched = false

bot.on('error',         err => console.error('💥 Telegram API error:', err.code, err.response?.body||err))
bot.on('polling_error', err => console.error('📡 Polling error:',     err.code, err.response?.body||err))
bot.on('message',       msg => console.log(`📨 [${msg.chat.id}] ${msg.from.username||'unknown'}: ${msg.text}`))

bot.getMe().then(me => {
  console.log(`✅ GENESIS активен как @${me.username}`)
  launched = true
})

// ╔════════════════════════════════════╗
// ║ ⚙️ Команды управления               ║
// ╚════════════════════════════════════╝

// /start — регистрация + меню + WebApp-кнопка
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id
  const uid    = msg.from.id

  registerUser(uid)
  sendReplyMenu(bot, chatId, uid, '🚀 Добро пожаловать! Вы успешно зарегистрированы.')

  // Отправляем inline-кнопку WebApp для карты
  bot.sendMessage(chatId, '🌐 Открыть карту:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🗺️ Перейти к карте',
            web_app: { url: 'https://genesis-data.onrender.com/map' }
          }
        ]
      ]
    }
  }).catch(console.error)
})

// /help — справка + меню
bot.onText(/\/help/, msg => {
  sendReplyMenu(bot, msg.chat.id, msg.from.id,
    '📖 Команды:\n' +
    '/start — регистрация\n' +
    '/status — состояние бота\n' +
    '/menu — меню\n' +
    '/poweroff, /poweron, /restart — админ'
  )
})

// /status — без меню
bot.onText(/\/status/, msg => {
  bot.sendMessage(msg.chat.id,
    `📊 Статус:\n` +
    `- Запущен: ${launched}\n` +
    `- Бот активен: ${isBotEnabled()}\n` +
    `- Юзеров: ${getUserCount()}`
  ).catch(console.error)
})

// /menu — просто меню
bot.onText(/\/menu/, msg => {
  sendReplyMenu(bot, msg.chat.id, msg.from.id)
})

// power-commands — только админ
bot.onText(/\/poweroff/, msg => {
  if (String(msg.from.id) === ADMIN_ID) {
    deactivateBotFlag()
    bot.sendMessage(msg.chat.id, '🛑 Бот остановлен.').then(() => process.exit(0))
  }
})
bot.onText(/\/poweron/, msg => {
  if (String(msg.from.id) === ADMIN_ID) {
    if (!isBotEnabled()) {
      activateBotFlag()
      bot.sendMessage(msg.chat.id, '✅ Бот включён.').catch(console.error)
    } else {
      bot.sendMessage(msg.chat.id, '⚠️ Уже активен.').catch(console.error)
    }
  }
})
bot.onText(/\/restart/, msg => {
  if (String(msg.from.id) === ADMIN_ID) {
    deactivateBotFlag()
    activateBotFlag()
    bot.sendMessage(msg.chat.id, '🔄 Перезапуск…').then(() => process.exit(0))
  }
})

// ╔════════════════════════════════════╗
// ║ 🔲 Обработка reply-кнопок          ║
// ╚════════════════════════════════════╝
const broadcastPending = new Set()
const disablePending   = new Set()

bot.on('message', async msg => {
  const text   = msg.text
  const chatId = msg.chat.id
  const uid    = String(msg.from.id)

  // … остальная логика без изменений …

  // ручное меню-switch
  switch (text) {
    case '🤖 Info':
      bot.sendMessage(chatId, '🤖 Версия: 1.0.0\n👨‍💻 Авторы: GENESIS')
      break

    case '🗺️ Карта':
      // здесь заменили простой линк на WebApp-кнопку
      bot.sendMessage(chatId, '🌐 Открыть карту:', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🗺️ Перейти к карте',
                web_app: { url: 'https://genesis-data.onrender.com/map' }
              }
            ]
          ]
        }
      }).catch(console.error)
      break

    // … остальные кейсы без изменений …
  }
})
