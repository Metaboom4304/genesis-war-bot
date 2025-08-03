FROM node:20-alpine

# 🌌 Рабочая директория
WORKDIR /app

# 🧹 Копируем lock-файл и манифест
COPY package-lock.json ./
COPY package.json ./

# 🛡️ Проверка наличия lock-файла
RUN [ -f package-lock.json ] || { echo '❌ lock-файл не найден. Протокол отменён.'; exit 1; }

# 🧼 Очистка кеша, установка зависимостей
RUN npm cache clean --force \
    && npm ci \
    && echo '✅ Чистая установка зависимостей завершена — NODE CORE SYNCHRONIZED'

# 📥 Копируем остальной проект
COPY . .

# 🚀 Запуск бот-системы
CMD ["npm", "start"]
