module.exports = {
  // ...другие параметры
  mapEnabled: true, // true — карта включена, false — отключена
};
module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  DEVELOPER_IDS: process.env.DEVELOPER_IDS
    .split(',')
    .map(id => parseInt(id.trim(), 10)),
  MAP_URL: process.env.MAP_URL,
};
