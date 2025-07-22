// utils/safeSend.js
function escapeMarkdownV2(text) {
  return text
    .replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

function safeSend(bot, chatId, text, options = {}) {
  const escaped = escapeMarkdownV2(text);
  return bot.sendMessage(chatId, escaped, {
    parse_mode: 'MarkdownV2',
    ...options
  });
}

module.exports = safeSend;
