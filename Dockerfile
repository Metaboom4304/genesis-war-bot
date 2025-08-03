FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN test -f package-lock.json && npm ci \
  && echo "✅ Dependencies synchronized" || { echo "❌ Lockfile missing"; exit 1; }

COPY . .

CMD ["npm", "start"]
