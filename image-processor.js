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

// Usa la transformación de Cloudinary para eliminar el fondo blanco/claro
// e_make_transparent es gratuita y funciona del lado del servidor
function urlProductoSinFondo(cloudinaryUrl) {
  if (!cloudinaryUrl || !cloudinaryUrl.includes('cloudinary.com')) return cloudinaryUrl;
  // Insertar transformación justo después de /upload/ y forzar PNG
  return cloudinaryUrl.replace('/upload/', '/upload/e_make_transparent:30,f_png/');
}

async function compositarProductoEnEspacio(roomBuffer, productUrl) {
  const roomMeta = await sharp(roomBuffer).metadata();
  const roomW = roomMeta.width  || 1024;
  const roomH = roomMeta.height || 1024;

  // Pedir a Cloudinary la imagen sin fondo (e_make_transparent)
  const transparentUrl = urlProductoSinFondo(productUrl);
  console.log('[IMG] URL producto sin fondo:', transparentUrl);
  const productSinFondo = await fetchBuffer(transparentUrl);

  // Escalar producto a ~38% del ancho del cuarto
  const prodMeta = await sharp(productSinFondo).metadata();
  const targetW = Math.round(roomW * 0.38);
  const ratio   = (prodMeta.height || 1) / (prodMeta.width || 1);
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

    console.log('[IMG] Componiendo con producto:', sofaInfo.nombre);
    const resultBuffer = await compositarProductoEnEspacio(roomBuffer, sofaInfo.imagen);

    console.log('[IMG] Subiendo resultado a Cloudinary...');
    const cloudinaryUrl = await uploadBufferToCloudinary(resultBuffer);

    return { success: true, imageUrl: cloudinaryUrl };
  } catch (error) {
    console.error('[IMG] Error composición:', error.message, error.stack?.split('\n')[1] || '');
    return { success: false, error: error.message };
  }
}

module.exports = { processRoomImage, downloadFromTwilio };
