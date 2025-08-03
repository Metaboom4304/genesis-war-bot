# 🔹 Базовый образ с Node.js 20 (совместим с lockfileVersion: 3)
FROM node:20-alpine

# 🔹 Рабочая директория внутри контейнера
WORKDIR /app

# 🔹 Копируем package.json и lock-файл для установки зависимостей
COPY package*.json ./

# 🔹 Очищаем кэш и устанавливаем зависимости
RUN npm cache clean --force
RUN npm ci

# 🔹 Копируем остальной код бота
COPY . .

# 🔹 Указываем команду запуска (замени на своё имя файла при необходимости)
CMD ["node", "index.js"]
