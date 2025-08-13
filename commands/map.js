import { fetchMapStatus } from '../services/mapStatus.js';
import { sendReplyMenu } from '../utils/menu.js';
import { registerUser } from '../services/supabaseUser.js';

export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from?.id);
    const username = msg.from?.username || '';
    const firstName = msg.from?.first_name || '';
    const lastName = msg.from?.last_name || '';
    const langCode = msg.from?.language_code || '';

    try {
      await registerUser({ uid, username, firstName, lastName, langCode });
      console.log(`✅ Пользователь зарегистрирован: ${uid}`);
    } catch (err) {
      console.error(`❌ Ошибка при регистрации пользователя ${uid}:`, err.message);
    }

    try {
      const { status } = await fetchMapStatus();

      if (status?.disableUntil) {
        const until = new Date(status.disableUntil);
        if (!Number.isNaN(until.getTime()) && until > new Date()) {
          await bot.sendMessage(chatId, `🛑 Карта временно отключена до ${until.toLocaleString('ru-RU')}.`);
          return sendReplyMenu(bot, chatId, uid);
        }
      }

      if (!status?.enabled) {
        await bot.sendMessage(chatId, '🛑 Карта сейчас отключена.');
        return sendReplyMenu(bot, chatId, uid);
      }

      const messageToSend = status.message || '🗺 Карта доступна.';
      await bot.sendMessage(chatId, messageToSend, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    } catch (err) {
      console.error('❌ Ошибка при получении статуса карты:', err.message);
      await bot.sendMessage(chatId, '❌ Ошибка при получении карты.');
    }

    sendReplyMenu(bot, chatId, uid);
  }
};
