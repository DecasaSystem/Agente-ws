require('dotenv').config();
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function downloadFromTwilio(mediaUrl) {
  const auth = Buffer.from(
    process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN
  ).toString('base64');
  const { fetchWithTimeout } = require('./httpClient');
  const response = await fetchWithTimeout(mediaUrl, {
    headers: { 'Authorization': 'Basic ' + auth }
  });
  if (!response.ok) throw new Error('Failed to download from Twilio: ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchBuffer(url) {
  const { fetchWithTimeout } = require('./httpClient');
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error('Failed to fetch image: ' + url);
  return Buffer.from(await response.arrayBuffer());
}

async function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'decasa-rooms', public_id: 'room-result-' + Date.now(), format: 'jpg' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Flood-fill desde los bordes para detectar y eliminar el fondo
// Más robusto que un umbral global: maneja sombras y gradientes
async function removeBackground(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = Buffer.from(data);
  const TOLERANCE = 40;

  // Muestrear color de fondo promediando las 4 esquinas
  const cornerIdxs = [0, (width - 1), (height - 1) * width, (height - 1) * width + (width - 1)];
  let sumR = 0, sumG = 0, sumB = 0;
  for (const ci of cornerIdxs) {
    sumR += pixels[ci * 4]; sumG += pixels[ci * 4 + 1]; sumB += pixels[ci * 4 + 2];
  }
  const bgR = Math.round(sumR / 4), bgG = Math.round(sumG / 4), bgB = Math.round(sumB / 4);

  const similar = (pi) => {
    const r = pixels[pi], g = pixels[pi + 1], b = pixels[pi + 2];
    return Math.abs(r - bgR) < TOLERANCE && Math.abs(g - bgG) < TOLERANCE && Math.abs(b - bgB) < TOLERANCE;
  };

  // BFS desde todos los píxeles del borde que sean similares al fondo
  const visited = new Uint8Array(width * height);
  const queue = [];

  const seed = (x, y) => {
    const pos = y * width + x;
    if (!visited[pos] && similar(pos * 4)) { visited[pos] = 1; queue.push(pos); }
  };

  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }

  while (queue.length > 0) {
    const pos = queue.pop();
    pixels[pos * 4 + 3] = 0; // transparente
    const x = pos % width, y = Math.floor(pos / width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const npos = ny * width + nx;
      if (!visited[npos] && similar(npos * 4)) { visited[npos] = 1; queue.push(npos); }
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function compositarProductoEnEspacio(roomBuffer, productBuffer) {
  const roomMeta = await sharp(roomBuffer).metadata();
  const roomW = roomMeta.width  || 1024;
  const roomH = roomMeta.height || 1024;

  // Quitar fondo del producto
  const productSinFondo = await removeBackground(productBuffer);

  // Escalar producto a ~38% del ancho del cuarto
  const prodMeta = await sharp(productSinFondo).metadata();
  const targetW = Math.round(roomW * 0.38);
  const ratio   = prodMeta.height / prodMeta.width;
  const targetH = Math.round(targetW * ratio);

  const productEscalado = await sharp(productSinFondo)
    .resize(targetW, targetH, { fit: 'inside' })
    .toBuffer();

  // Posición: centrado horizontalmente, apoyado en el tercio inferior
  const left = Math.round((roomW - targetW) / 2);
  const top  = Math.max(0, Math.round(roomH * 0.58) - Math.round(targetH / 2));

  const resultado = await sharp(roomBuffer)
    .composite([{ input: productEscalado, left, top, blend: 'over' }])
    .jpeg({ quality: 88 })
    .toBuffer();

  return resultado;
}

async function processRoomImage(mediaUrl, sofaInfo) {
  sofaInfo = sofaInfo || null;
  try {
    console.log('[IMG] Descargando imagen del espacio...');
    const roomBuffer = await downloadFromTwilio(mediaUrl);

    if (!sofaInfo || !sofaInfo.imagen) {
      return { success: false, error: 'SIN_PRODUCTO', message: '¿Cuál mueble quieres ver en tu espacio? Primero cuéntame qué producto te interesa y luego mándame la foto 😊' };
    }

    console.log('[IMG] Descargando imagen del producto:', sofaInfo.nombre);
    const productBuffer = await fetchBuffer(sofaInfo.imagen);

    console.log('[IMG] Componiendo imagen...');
    const resultBuffer = await compositarProductoEnEspacio(roomBuffer, productBuffer);

    console.log('[IMG] Subiendo resultado a Cloudinary...');
    const cloudinaryUrl = await uploadBufferToCloudinary(resultBuffer);

    return { success: true, imageUrl: cloudinaryUrl };
  } catch (error) {
    console.error('[IMG] Error composición:', error.message, error.stack?.split('\n')[1] || '');
    return { success: false, error: error.message };
  }
}

module.exports = { processRoomImage, downloadFromTwilio };
