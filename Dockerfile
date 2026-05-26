FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY index.js ./
COPY knowledge.json ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
