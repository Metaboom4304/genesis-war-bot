const styles = {
  default: (text) =>
    `╭── 🛡 *Genesis War Map: сообщение от администрации* ──╮\n> ${text}\n╰──────────────────────────────────────────────────╯`,

  alert: (text) =>
    `⚠️ *Genesis War Map — срочное объявление!*\n\n> ${text}\n\n🔗 https://genesis-map.example.com`,

  update: (text) =>
    `📈 *Genesis War Map: обновление тайлов*\n\n> ${text}\n\n🔄 Проверьте новые зоны на карте!`
};

module.exports = styles;
