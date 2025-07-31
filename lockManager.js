const fs = require('fs');
const path = require('path');

const LOCK_DIR = path.join(__dirname, '..', 'memory'); // путь к папке lock-файлов

function isEnabled(lockName) {
  const lockPath = path.join(LOCK_DIR, `${lockName}.lock`);
  return fs.existsSync(lockPath);
}

module.exports = { isEnabled };
