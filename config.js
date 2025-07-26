module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  MAP_URL: process.env.MAP_URL,
  DEVELOPER_IDS: process.env.DEVELOPER_IDS
    ? process.env.DEVELOPER_IDS.split(',').map(id => Number(id.trim()))
    : [],
  mapEnabled: true
};
