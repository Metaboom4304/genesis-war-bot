import { fetchMapStatus } from '../services/mapStatus.js';
import { sendReplyMenu } from '../utils/menu.js';
import { registerUser } from '../services/supabaseUser.js';

export default {
  name: 'map',
  async execute(bot, msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from?.id);

    try {
      const { status } = await fetchMapStatus();
      if (!status?.enabled) {
        await bot.sendMessage(chatId, '🛑 Карта сейчас отключена.');
        return sendReplyMenu(bot, chatId, uid);
      }
      await bot.sendMessage(chatId, status.message || '🗺 Карта доступна.');
    } catch (err) {
      console.error('❌ Ошибка карты:', err);
      await bot.sendMessage(chatId, '❌ Ошибка при получении карты.');
    }
    sendReplyMenu(bot, chatId, uid);
  }
};
