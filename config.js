// config.js
module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  DEVELOPER_IDS: process.env.DEVELOPER_IDS
    .split(',')
    .map(id => parseInt(id.trim(), 10)),
};
