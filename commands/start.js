module.exports = {
  name: 'start',
  execute(ctx) {
    ctx.reply('🔓 Genesis is back online!', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🗺 Открыть карту',
            web_app: {
              url: 'https://genesis-data.onrender.com'
            }
          }
        ]]
      }
    })
  }
}
