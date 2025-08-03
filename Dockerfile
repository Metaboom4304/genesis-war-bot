# Используем node-образ
FROM node:18

# Создаем директорию приложения
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package.json ./
COPY package-lock.json ./

# Установка зависимостей
RUN npm install

# Копируем весь код
COPY . .

# Запускаем бота
CMD ["node", "GENESIS_LAUNCHER.js"]
