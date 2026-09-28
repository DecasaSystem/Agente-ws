FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Todo el código del agente (antes solo se copiaba index.js y knowledge.json, y el
# contenedor moría en el primer require de db.js).
COPY *.js ./
COPY knowledge.json ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
