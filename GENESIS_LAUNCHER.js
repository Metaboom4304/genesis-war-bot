// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const { Octokit } = require('@octokit/rest')

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: Проверьте наличие всех обязательных переменных              ║
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

const TOKEN         = process.env.TELEGRAM_TOKEN
const ADMIN_ID      = String(process.env.ADMIN_ID)
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN
const GITHUB_OWNER  = process.env.GITHUB_OWNER
const GITHUB_REPO   = process.env.GITHUB_REPO
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'

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

  bot.sendMessage(chatId, text, {
    reply_markup: { keyboard, resize_keyboard: true }
  }).catch(console.error)
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
    await bot.sendMessage(uid, '✅ Рассылка выполнена.')
    return sendReplyMenu(bot, chatId, uid)
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
    await bot.sendMessage(chatId, '✅ Карта отключена и всем уведомлено.')
    return sendReplyMenu(bot, chatId, uid)
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

    case '🤖 Info':
      try {
        const { status } = await fetchMapStatus()
        await bot.sendMessage(
          chatId,
          `🧐 Info:\n` +
          `- enabled: ${status.enabled}\n` +
          `- message: ${status.message}`
        )
      } catch (err) {
        console.error('🛑 Ошибка Info:', err)
        await bot.sendMessage(chatId, '❌ Не удалось получить информацию.')
      }
      sendReplyMenu(bot, chatId, uid)
      break

    case '🛣 Roadmap':
      await bot.sendMessage(
        chatId,
        `🛣 Roadmap:\nhttps://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/ROADMAP.md`
      )
      sendReplyMenu(bot, chatId, uid)
      break

    case '🌐 Ссылки':
      await bot.sendMessage(
        chatId,
        '🌐 Ссылки:\n' +
        `• GitHub: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}\n` +
        '• Поддержка: https://t.me/your_support_chat'
      )
      sendReplyMenu(bot, chatId, uid)
      break

    case '🗺 Карта':
      try {
        const { status } = await fetchMapStatus()
        await bot.sendMessage(chatId, status.message)
      } catch (err) {
        console.error('🛑 Ошибка Карта:', err)
        await bot.sendMessage(chatId, '❌ Не удалось получить карту.')
      }
      sendReplyMenu(bot, chatId, uid)
      break

    case '❓ Помощь':
      await bot.sendMessage(
        chatId,
        '❓ Помощь:\n' +
        '– Используйте кнопки меню для навигации\n' +
        '– /help для списка команд\n' +
        '– Свяжитесь с админом при проблемах'
      )
      sendReplyMenu(bot, chatId, uid)
      break

    case '📃 Логи':
      try {
        const logs = fs.readFileSync(path.join(__dirname, 'logs.txt'), 'utf8')
        await bot.sendMessage(chatId, `📃 Логи:\n${logs}`)
      } catch {
        await bot.sendMessage(chatId, '📃 Логи недоступны.')
      }
      sendReplyMenu(bot, chatId, uid)
      break

    case '👥 Добавить админа':
      await bot.sendMessage(chatId, '👥 Добавление админа пока не реализовано.')
      sendReplyMenu(bot, chatId, uid)
      break

    case '📑 Список админов':
      await bot.sendMessage(chatId, `📑 Админы:\n• ${ADMIN_ID}`)
      sendReplyMenu(bot, chatId, uid)
      break

    default:
      sendReplyMenu(bot, chatId, uid)
      break
  }
})
