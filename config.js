module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  MAP_URL: process.env.MAP_URL,
  DEVELOPER_IDS: process.env.DEVELOPER_IDS
    ? process.env.DEVELOPER_IDS.split(',').map(id => Number(id.trim()))
    : [],
  mapEnabled: true
};
console.log('[CONFIG DEBUG] Developer IDs:', module.exports.DEVELOPER_IDS);
console.log('[CONFIG DEBUG] Type of first ID:', typeof module.exports.DEVELOPER_IDS[0]);
