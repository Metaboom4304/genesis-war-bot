#!/bin/bash

echo "🔮 INITIATING ENGINEERING PROTOCOLS..."

# ⚰️ Удаление предыдущей сборки (если есть)
rm -rf ./dist ./node_modules
echo "🧹 Workspace cleaned — ancient remnants purged"

# 🔄 Проверка lock-файла
if [ ! -f "package-lock.json" ]; then
    echo "❌ Lock-файл отсутствует. Сборка прервана."
    exit 1
fi

# 📦 Установка зависимостей
npm cache clean --force
npm ci
echo "✅ Dependencies locked and installed — purity ensured"

# 🚧 Сборка Docker-образа
docker build -t genesis-war-bot .
echo "🚀 Container forged — GENESIS WAR BOT prepared for battle"
