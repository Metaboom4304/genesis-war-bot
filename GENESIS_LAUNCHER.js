// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const { Octokit } = require('@octokit/rest')

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: Проверьте наличе всех обязательных переменных                ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const requiredEnv = [
  'TELEGRAM_TOKEN',
  'ADMIN_ID',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO'
]

let envValid = true
console.log('\n🤍 Инициализация GENESIS_LAUNCHER…')

for (const key of requiredEnv) {
  const val = process.env[key]
  if (!val) {
    console.log(`🔴 ENV отсутствует: ${key}`)
    envValid = false
  } else {
    console.log(`🟢 ${key} активен: ${val.slice(0,6)}…`)
  }
}

if (!envValid) {
  console.log('\n⛔️ Задайте все ENV-переменные и перезапустите.')
  process.exit(1)
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 📦 Константы                                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const TOKEN          = process.env.TELEGRAM_TOKEN
const ADMIN_ID       = String(process.env.ADMIN_ID)
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN
const GITHUB_OWNER   = process.env.GITHUB_OWNER
const GITHUB_REPO    = process.env.GITHUB_REPO
const GITHUB_BRANCH  = process.env.GITHUB_BRANCH || 'main'

const octokit = new Octokit({ auth: GITHUB_TOKEN })

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 📂 Файловая и флаговая логика                                               ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const memoryPath = path.join(__dirname, 'memory')
const usersPath  = path.join(__dirname, 'users.json')
const lockPath   = path.join(memoryPath, 'botEnabled.lock')

if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath)
if (!fs.existsSync(usersPath))  fs.writeFileSync(usersPath, JSON.stringify({}, null, 2))
if (!fs.existsSync(lockPath))   fs.writeFileSync(lockPath, 'enabled')

function isBotEnabled() {
  return fs.existsSync(lockPath)
}

function activateBotFlag() {
  fs.writeFileSync(lockPath, 'enabled')
}

function deactivateBotFlag() {
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath)
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 📑 Пользователи и статистика                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

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

function getUserCount() {
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    return Object.keys(users).length
  } catch {
    return 0
  }
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🌐 GitHub / map-status.json через Octokit                                  ║
// ╚════════════════════════════════════════════════════════════════════════════╝

async function fetchMapStatus() {
  const res = await octokit.rest.repos.getContent({
    owner: GITHUB_OWNER,
    repo:  GITHUB_REPO,
    path:  'map-status.json',
    ref:   GITHUB_BRANCH
  })
  const raw = Buffer.from(res.data.content, 'base64').toString()
  return { sha: res.data.sha, status: JSON.parse(raw) }
}

async function updateMapStatus({ enabled, message, theme = 'auto', disableUntil }) {
  const { sha } = await fetchMapStatus()
  const newStatus = { enabled, message, theme, disableUntil }
  const content   = Buffer.from(JSON.stringify(newStatus, null, 2)).toString('base64')

  await octokit.rest.repos.createOrUpdateFileContents({
    owner:   GITHUB_OWNER,
    repo:    GITHUB_REPO,
    path:    'map-status.json',
    message: `🔄 Update map-status: enabled=${enabled}`,
    content,
    sha,
    branch:  GITHUB_BRANCH
  })
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 📢 Рассылка сообщений                                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

async function broadcastAll(bot, message) {
  let users = {}
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
  } catch {}
  for (const uid of Object.keys(users)) {
    try {
      await bot.sendMessage(uid, message)
    } catch (err) {
      console.error(`⚠️ Не отправить ${uid}:`, err.response?.body || err)
      if (err.response?.statusCode === 403) {
        delete users[uid]
        console.log(`🗑️ Удалён пользователь ${uid}`)
      }
    }
  }
  try {
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
  } catch {}
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🗂️ Меню и клавиатуры                                                       ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function sendReplyMenu(bot, chatId, uid, text = '📋 Меню доступно:') {
  uid = String(uid)
  const isAdmin = uid === ADMIN_ID

  const baseButtons = [
    ['🤖 Info', '🛣 Roadmap'],
    ['🌐 Ссылки', '🗺 Карта'],
    ['❓ Помощь']
  ]

  const adminButtons = [
    ['📢 Рассылка', '📃 Логи'],
    ['⚠️ Выключить карту', '🔄 Включить карту'],
    ['👥 Добавить админа', '📑 Список админов']
  ]

  const keyboard = isAdmin
    ? baseButtons.concat(adminButtons)
    : baseButtons

  bot
    .sendMessage(chatId, text, {
      reply_markup: {
        keyboard,
        resize_keyboard: true
      }
    })
    .catch(console.error)
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🤖 Инициализация бота                                                      ║
// ╚════════════════════════════════════════════════════════════════════════════╝

activateBotFlag()
const bot = new TelegramBot(TOKEN, { polling: true })
let launched = false

bot.on('error',          err => console.error('💥 Telegram API error:', err.code, err.response?.body || err))
bot.on('polling_error',  err => console.error('🛑 Polling error:', err.code, err.response?.body || err))
bot.on('message',        msg => console.log(`📨 [${msg.chat.id}] ${msg.from.username || 'unknown'}: ${msg.text}`))

bot.getMe()
  .then(me => {
    console.log(`✅ GENESIS активен как @${me.username}`)
    launched = true
  })

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ ⚙️ Команды и потоковые обработчики                                         ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const broadcastPending = new Set()
const disablePending   = new Set()

bot.on('message', async msg => {
  const text   = msg.text
  const chatId = msg.chat.id
  const uid    = String(msg.from.id)

  // — Обработка force-reply для рассылки
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text.includes('Напишите текст для рассылки')
  ) {
    broadcastPending.delete(uid)
    await broadcastAll(bot, text)
    bot.sendMessage(uid, '✅ Рассылка выполнена.')
      .then(() => sendReplyMenu(bot, chatId, uid))
    return
  }

  // — Обработка force-reply для выключения карты
  if (
    disablePending.has(uid) &&
    msg.reply_to_message?.text.includes('Подтвердите отключение карты')
  ) {
    disablePending.delete(uid)
    const disableMsg = 
      '🔒 Genesis временно отключён.\n' +
      'Мы взяли тайм-аут, чтобы подготовить кое-что грандиозное.\n' +
      '📍 Скоро включим radar.'

    try {
      await updateMapStatus({
        enabled: false,
        message: disableMsg,
        theme: 'auto',
        disableUntil: new Date().toISOString()
      })
    } catch (err) {
      console.error('🛑 Ошибка при отключении карты:', err)
      await bot.sendMessage(chatId, '❌ Не удалось отключить карту.')
      return sendReplyMenu(bot, chatId, uid)
    }

    await broadcastAll(bot, disableMsg)
    bot.sendMessage(chatId, '✅ Карта отключена и всем уведомлено.')
      .then(() => sendReplyMenu(bot, chatId, uid))
    return
  }

  // — Основные команды
  switch (text) {
    case '/start':
      registerUser(uid)
      sendReplyMenu(bot, chatId, uid,
        '🚀 Добро пожаловать! Вы успешно зарегистрированы.'
      )
      break

    case '/help':
      sendReplyMenu(bot, chatId, uid,
        '📖 Команды:\n' +
        '/start — регистрация\n' +
        '/status — состояние бота\n' +
        '/menu — меню'
      )
      break

    case '/status':
      bot.sendMessage(chatId,
        `📊 Статус:\n` +
        `- Запущен: ${launched}\n` +
        `- Бот активен: ${isBotEnabled()}\n` +
        `- Юзеров: ${getUserCount()}`
      ).catch(console.error)
      break

    case '/menu':
      sendReplyMenu(bot, chatId, uid)
      break

    case '📢 Рассылка':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid)
        bot.sendMessage(chatId, '✏️ Напишите текст для рассылки:', {
          reply_markup: { force_reply: true }
        })
      }
      break

    case '⚠️ Выключить карту':
      if (uid === ADMIN_ID) {
        disablePending.add(uid)
        bot.sendMessage(chatId, '⚠️ Подтвердите отключение карты:', {
          reply_markup: { force_reply: true }
        })
      }
      break

    case '🔄 Включить карту':
      if (uid === ADMIN_ID) {
        const enableMsg = '🔓 Genesis сейчас в эфире!'
        try {
          await updateMapStatus({
            enabled: true,
            message: enableMsg,
            theme: 'auto',
            disableUntil: new Date().toISOString()
          })
          await bot.sendMessage(chatId, '✅ Карта включена. Все снова подключены.')
        } catch (err) {
          console.error('🛑 Ошибка при включении карты:', err)
          await bot.sendMessage(chatId, '❌ Не удалось включить карту.')
        }
        sendReplyMenu(bot, chatId, uid)
      }
      break

    // … остальные кейсы (Info, Roadmap, Ссылки, Карта, Помощь, Логи, Добавить админа, Список админов)
  }
})
```[43dcd9a7-70db-4a1f-b0ae-981daa162054](https://github.com/tlemsl/tlemsl.github.io/tree/238b7319f4518674f12411412f4e5e0b2bce56d3/_posts%2F2021-01-03-enable-google-pv.md?citationMarker=43dcd9a7-70db-4a1f-b0ae-981daa162054 "1")[43dcd9a7-70db-4a1f-b0ae-981daa162054](https://github.com/glascaleia/geotoolkit-pending/tree/e3908e9dfefc415169f80787cff8c94af4afce17/modules%2Finterop%2Fgeotk-mapfile%2Fsrc%2Ftest%2Fjava%2Forg%2Fgeotoolkit%2Fmapfile%2FReaderTest.java?citationMarker=43dcd9a7-70db-4a1f-b0ae-981daa162054 "2")[43dcd9a7-70db-4a1f-b0ae-981daa162054](https://github.com/renatoAraujoSantos/produtor-desenv/tree/3b26241d327bf31c2873d5ec512e2e55a70834ec/src%2Fscreens%2Ffornecedor%2Fscreens%2FProduto%2FProdutoScreen.js?citationMarker=43dcd9a7-70db-4a1f-b0ae-981daa162054 "3")[43dcd9a7-70db-4a1f-b0ae-981daa162054](https://github.com/vzehirev/crmi/tree/efa7bf302a08f08d170b6acb992f105558fa7c32/lib%2Futil%2Fregex.php?citationMarker=43dcd9a7-70db-4a1f-b0ae-981daa162054 "4")[43dcd9a7-70db-4a1f-b0ae-981daa162054](https://github.com/WillemMe/The-Lost-Treasure/tree/2225f7ca61791eb4503e6c8f779b50b805bfd1d0/app.js?citationMarker=43dcd9a7-70db-4a1f-b0ae-981daa162054 "5")[43dcd9a7-70db-4a1f-b0ae-981daa162054](https://github.com/Kombiz-Khayami/Resume/tree/a5c3a015bd96d79c03657b89992e2bdd6a91ec07/Linux%2Ftree%20project%2F7khayk2014FUNCS.sh?citationMarker=43dcd9a7-70db-4a1f-b0ae-981daa162054 "6")
