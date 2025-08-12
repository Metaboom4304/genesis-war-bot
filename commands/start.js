ctx.reply('Запуск карты...', {
  reply_markup: {
    inline_keyboard: [[{
      text: 'Открыть карту',
      web_app: { url: 'https://genesis-data.onrender.com' }
    }]]
  }
})
