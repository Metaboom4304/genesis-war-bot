module.exports = {
  // Ваш токен бота
  botToken: '7982838066:AAEoYlj-nFUs0mac0eUsiIKtslimQkIKQNo',
  // Настройки для авторизации
  auth: {
    required: true,  // Требовать авторизацию
    adminId: '766057421',  // Ваш ID для доступа
  },
};

console.log('[CONFIG DEBUG] Developer IDs:', module.exports.DEVELOPER_IDS);
console.log('[CONFIG DEBUG] Type of first ID:', typeof module.exports.DEVELOPER_IDS[0]);
