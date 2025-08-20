// commands/logs_button.js
export default {
  name: '📝 Логи',
  description: 'Получить логи работы бота',
  execute: async (bot, msg) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    
    // Проверяем, является ли пользователь админом
    if (userId !== process.env.ADMIN_ID) {
      return bot.sendMessage(chatId, '❌ У вас нет прав для просмотра логов.');
    }
    
    // Читаем логи из файла
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const logsPath = path.join(process.cwd(), 'logs.txt');
      if (fs.existsSync(logsPath)) {
        let logs = fs.readFileSync(logsPath, 'utf8');
        
        // Ограничиваем длину сообщения
        if (logs.length > 4000) {
          logs = logs.substring(logs.length - 4000);
          logs = '...\n' + logs;
        }
        
        // Отправляем логи пользователю
        await bot.sendMessage(chatId, `<pre>${logs}</pre>`, {
          parse_mode: 'HTML'
        });
      } else {
        await bot.sendMessage(chatId, '📭 Файл логов не найден.');
      }
    } catch (error) {
      console.error('Ошибка при чтении логов:', error);
      await bot.sendMessage(chatId, `❌ Ошибка при чтении логов: ${error.message}`);
    }
  }
};
