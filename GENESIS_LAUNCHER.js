// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🧠 GENESIS_LAUNCHER — Telegram Control                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

// ───────────────────────────────────────────────────────────────────────────────
// 0. Keep-alive Express server for Render free tier
require('dotenv').config()           // if you use a .env locally
const express = require('express')
const app     = express()
const PORT    = process.env.PORT || 3000

app.get('/', (_req, res) => res.send('🤖 GENESIS bot is alive!'))
app.listen(PORT, () => console.log(`🌐 Express listening on port ${PORT}`))
// ───────────────────────────────────────────────────────────────────────────────

const fs           = require('fs')
const path         = require('path')
const TelegramBot  = require('node-telegram-bot-api')
const { Octokit }  = require('@octokit/rest')

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🛡️ ENV GUARD: check for all required environment variables                ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const requiredEnv = [
  'TELEGRAM_TOKEN',
  'ADMIN_ID',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO'
]

let envValid = true
console.log('\n🤍 Initializing GENESIS_LAUNCHER…')
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.log(`🔴 Missing ENV: ${key}`)
    envValid = false
  } else {
    console.log(`🟢 ${key} present`)
  }
}
if (!envValid) {
  console.log('\n⛔️ Please set all ENV variables and restart.')
  process.exit(1)
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 📦 Constants                                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const TOKEN         = process.env.TELEGRAM_TOKEN
const ADMIN_ID      = String(process.env.ADMIN_ID)
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN
const GITHUB_OWNER  = process.env.GITHUB_OWNER
const GITHUB_REPO   = process.env.GITHUB_REPO
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'

const octokit = new Octokit({ auth: GITHUB_TOKEN })

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 📂 File system paths & bot-enabled flag                                   ║
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
// ║ 📑 User registration & stats                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function registerUser(userId) {
  userId = String(userId)
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
    if (!users[userId]) {
      users[userId] = { registered: true, ts: Date.now() }
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
      console.log(`👤 Registered user: ${userId}`)
    }
  } catch (err) {
    console.error('❌ Failed to write users.json:', err)
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
// ║ 🌐 GitHub map-status.json via Octokit                                      ║
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
  const { sha }    = await fetchMapStatus()
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
// ║ 📢 Broadcast messages                                                      ║
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
      console.error(`⚠️ Cannot send to ${uid}:`, err.response?.body || err)
      if (err.response?.statusCode === 403) {
        delete users[uid]
        console.log(`🗑️ Removed user ${uid}`)
      }
    }
  }
  try {
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
  } catch {}
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🗂️ Reply-keyboard menus                                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function sendReplyMenu(bot, chatId, uid, text = '📋 Menu:') {
  uid = String(uid)
  const isAdmin = uid === ADMIN_ID

  const baseButtons = [
    ['🤖 Info', '🛣 Roadmap'],
    ['🌐 Links', '🗺 Map'],
    ['❓ Help']
  ]
  const adminButtons = [
    ['📢 Broadcast', '📃 Logs'],
    ['⚠️ Disable map', '🔄 Enable map'],
    ['👥 Add admin', '📑 Admins']
  ]
  const keyboard = isAdmin
    ? baseButtons.concat(adminButtons)
    : baseButtons

  bot.sendMessage(chatId, text, {
    reply_markup: { keyboard, resize_keyboard: true }
  }).catch(console.error)
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 🤖 Bot initialization                                                      ║
// ╚════════════════════════════════════════════════════════════════════════════╝

activateBotFlag()

// single declaration of bot
const bot = new TelegramBot(TOKEN, { polling: true })

let launched = false

bot.on('error',         err => console.error('💥 Telegram API error:', err.code, err.response?.body || err))
bot.on('polling_error', err => console.error('🛑 Polling error:', err.code, err.response?.body || err))
bot.on('message',       msg => console.log(`📨 [${msg.chat.id}] ${msg.from.username || 'unknown'}: ${msg.text}`))

bot.getMe()
  .then(me => {
    console.log(`✅ GENESIS active as @${me.username}`)
    launched = true
  })

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ ⚙️ Command handlers & message flows                                         ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const broadcastPending = new Set()
const disablePending   = new Set()

bot.on('message', async msg => {
  const text   = msg.text
  const chatId = msg.chat.id
  const uid    = String(msg.from.id)

  // — Broadcast force-reply
  if (
    broadcastPending.has(uid) &&
    msg.reply_to_message?.text.includes('Write broadcast text')
  ) {
    broadcastPending.delete(uid)
    await broadcastAll(bot, text)
    await bot.sendMessage(uid, '✅ Broadcast sent.')
    return sendReplyMenu(bot, chatId, uid)
  }

  // — Disable map force-reply
  if (
    disablePending.has(uid) &&
    msg.reply_to_message?.text.includes('Confirm disabling map')
  ) {
    disablePending.delete(uid)
    const disableMsg =
      '🔒 Genesis temporarily disabled.\n' +
      'We\'ll be back soon with something big.'

    try {
      await updateMapStatus({
        enabled: false,
        message: disableMsg,
        theme: 'auto',
        disableUntil: new Date().toISOString()
      })
    } catch (err) {
      console.error('🛑 Disable error:', err)
      await bot.sendMessage(chatId, '❌ Failed to disable map.')
      return sendReplyMenu(bot, chatId, uid)
    }

    await broadcastAll(bot, disableMsg)
    await bot.sendMessage(chatId, '✅ Map disabled and everyone notified.')
    return sendReplyMenu(bot, chatId, uid)
  }

  // — Main commands
  switch (text) {
    case '/start':
      registerUser(uid)
      sendReplyMenu(bot, chatId, uid,
        '🚀 Welcome! You\'re now registered.'
      )
      break

    case '/help':
      sendReplyMenu(bot, chatId, uid,
        '📖 Commands:\n' +
        '/start — register\n' +
        '/status — bot status\n' +
        '/menu — show menu'
      )
      break

    case '/status':
      bot.sendMessage(chatId,
        `📊 Status:\n` +
        `- Launched: ${launched}\n` +
        `- Bot enabled: ${isBotEnabled()}\n` +
        `- Users: ${getUserCount()}`
      ).catch(console.error)
      break

    case '/menu':
      sendReplyMenu(bot, chatId, uid)
      break

    case '📢 Broadcast':
      if (uid === ADMIN_ID) {
        broadcastPending.add(uid)
        bot.sendMessage(chatId, '✏️ Write broadcast text:', {
          reply_markup: { force_reply: true }
        })
      }
      break

    case '⚠️ Disable map':
      if (uid === ADMIN_ID) {
        disablePending.add(uid)
        bot.sendMessage(chatId, '⚠️ Confirm disabling map:', {
          reply_markup: { force_reply: true }
        })
      }
      break

    case '🔄 Enable map':
      if (uid === ADMIN_ID) {
        const enableMsg = '🔓 Genesis is back online!'
        try {
          await updateMapStatus({
            enabled: true,
            message: enableMsg,
            theme: 'auto',
            disableUntil: new Date().toISOString()
          })
          await bot.sendMessage(chatId, '✅ Map enabled.')
        } catch (err) {
          console.error('🛑 Enable error:', err)
          await bot.sendMessage(chatId, '❌ Failed to enable map.')
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
        console.error('🛑 Info error:', err)
        await bot.sendMessage(chatId, '❌ Failed to fetch info.')
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

    case '🌐 Links':
      await bot.sendMessage(
        chatId,
        '🌐 Links:\n' +
        `• GitHub: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}\n` +
        '• Support: https://t.me/your_support_chat'
      )
      sendReplyMenu(bot, chatId, uid)
      break

    case '🗺 Map':
      try {
        const { status } = await fetchMapStatus()
        await bot.sendMessage(chatId, status.message)
      } catch (err) {
        console.error('🛑 Map error:', err)
        await bot.sendMessage(chatId, '❌ Failed to fetch map.')
      }
      sendReplyMenu(bot, chatId, uid)
      break

    case '❓ Help':
      await bot.sendMessage(
        chatId,
        '❓ Help:\n' +
        '– Use the menu buttons\n' +
        '– /help for commands\n' +
        '– Contact admin for issues'
      )
      sendReplyMenu(bot, chatId, uid)
      break

    case '📃 Logs':
      try {
        const logs = fs.readFileSync(path.join(__dirname, 'logs.txt'), 'utf8')
        await bot.sendMessage(chatId, `📃 Logs:\n${logs}`)
      } catch {
        await bot.sendMessage(chatId, '📃 Logs not available.')
      }
      sendReplyMenu(bot, chatId, uid)
      break

    case '👥 Add admin':
      await bot.sendMessage(chatId, '👥 Add admin not implemented yet.')
      sendReplyMenu(bot, chatId, uid)
      break

    case '📑 Admins':
      await bot.sendMessage(chatId, `📑 Admins:\n• ${ADMIN_ID}`)
      sendReplyMenu(bot, chatId, uid)
      break

    default:
      sendReplyMenu(bot, chatId, uid)
  }
})
