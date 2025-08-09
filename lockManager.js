// lockManager.js
const fs   = require('fs')
const path = require('path')
const LOCK_PATH = path.join(__dirname, 'memory', 'map.lock')

function checkLock() {
  // создаём папку memory, если нет
  const dir = path.dirname(LOCK_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function isLocked() {
  return fs.existsSync(LOCK_PATH)
}

module.exports = { checkLock, isLocked }
