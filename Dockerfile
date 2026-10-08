# Node 22 (LTS): sharp 0.35 —el parche de las vulnerabilidades de libvips/libheif que se
# alcanzan con las fotos de los clientes— exige Node >= 20.9. Node 18 ya no tiene soporte.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Todo el código del agente (antes solo se copiaba index.js y knowledge.json, y el
# contenedor moría en el primer require de db.js).
COPY *.js ./
# negocio.json es OBLIGATORIO: negocio.js no deja arrancar el agente sin él. Antes no se
# copiaba (y hasta el 2026-10-08 ni siquiera estaba versionado).
COPY knowledge.json negocio.json ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
