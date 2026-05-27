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

// Elimina fondo claro (blanco, crema, gris claro) dejando transparencia
async function removeBackground(imageBuffer) {
  const image = sharp(imageBuffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixels = Buffer.from(data);

  // Umbral para considerar "fondo claro"
  const TOLERANCE = 35;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const isNearWhite = r > 255 - TOLERANCE && g > 255 - TOLERANCE && b > 255 - TOLERANCE;
    // También captura tonos crema/beige claros comunes en fotos de muebles
    const isNearCream = r > 220 && g > 200 && b > 180 && r >= g && g >= b;
    if (isNearWhite || isNearCream) pixels[i + 3] = 0;
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
