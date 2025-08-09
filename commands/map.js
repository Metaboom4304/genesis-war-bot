const axios = require('axios');

module.exports = {
  command: 'map',
  handler: async (ctx) => {
    try {
      const response = await axios.get('https://genesis-data.onrender.com/map-status.json');
      const status = response.data;

      if (!status.enabled) {
        return ctx.reply('❌ Карта временно недоступна.');
      }

      await ctx.reply(status.message || '🗺 Карта доступна!', {
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Открыть карту',
              web_app: { url: 'https://genesis-data.onrender.com' }
            }
          ]]
        }
      });
    } catch (err) {
      console.error('❌ Ошибка загрузки карты:', err.message);
      return ctx.reply('❌ Failed to fetch map.');
    }
  }
};
