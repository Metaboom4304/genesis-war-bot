// mapController.js
const fs         = require('fs')
const { Octokit }= require('@octokit/rest')

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
const OWNER   = process.env.GITHUB_OWNER
const REPO    = process.env.GITHUB_REPO
const BRANCH  = process.env.GITHUB_BRANCH || 'main'

async function fetchMapStatus() {
  const res = await octokit.rest.repos.getContent({
    owner: OWNER, repo: REPO, path: 'map-status.json', ref: BRANCH
  })
  const raw = Buffer.from(res.data.content, 'base64').toString()
  return JSON.parse(raw)
}

function registerMap(bot) {
  // команда /map
  bot.onText(/\/map/, async (msg) => {
    try {
      const status = await fetchMapStatus()
      if (!status.enabled) {
        return bot.sendMessage(msg.chat.id, '🛑 Карта отключена')
      }
      // здесь логика открытия WebApp, например:
      bot.sendMessage(msg.chat.id, status.message, {
        reply_markup: {
          inline_keyboard: [[{
            text: '🗺 Открыть карту',
            web_app: { url: 'https://genesis-data.onrender.com' }
          }]]
        }
      })
    } catch (err) {
      console.error('Map fetch error:', err)
      bot.sendMessage(msg.chat.id, '❌ Failed to fetch map.')
    }
  })

  // или callback “map” через кнопки
  bot.on('callback_query', async query => {
    if (query.data !== 'map') return
    // та же логика, что и в /map
  })
}

module.exports = registerMap
