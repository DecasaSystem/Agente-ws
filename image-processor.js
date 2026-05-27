require('dotenv').config();
const OpenAI = require('openai');
const { toFile } = require('openai');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function downloadFromTwilio(mediaUrl) {
  const auth = Buffer.from(
    process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN
  ).toString('base64');

  const { fetchWithTimeout } = require('./httpClient');
  const response = await fetchWithTimeout(mediaUrl, {
    headers: { 'Authorization': 'Basic ' + auth }
  });

  if (!response.ok) {
    throw new Error('Failed to download from Twilio: ' + response.status);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function uploadBase64ToCloudinary(b64) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      `data:image/png;base64,${b64}`,
      { folder: 'decasa-rooms', public_id: 'room-result-' + Date.now() },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
  });
}

async function processWithOpenAI(imageBuffer, furnitureDescription) {
  const prompt = furnitureDescription
    ? `Realistically place a ${furnitureDescription} in this room. Keep all existing furniture, lighting, shadows and perspective. The result must look like a real photo.`
    : `Add a modern solid wood furniture piece in this room. Keep existing elements, lighting and perspective realistic.`;

  const imageFile = await toFile(imageBuffer, 'room.png', { type: 'image/png' });

  const response = await openai.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt,
    n: 1,
    size: '1024x1024'
  });

  return response.data[0].b64_json;
}

async function processRoomImage(mediaUrl, sofaInfo) {
  sofaInfo = sofaInfo || null;
  try {
    console.log('[IMG] Descargando imagen de Twilio...');
    const imageBuffer = await downloadFromTwilio(mediaUrl);

    console.log('[IMG] Procesando con OpenAI gpt-image-1...');
    const sofaDesc = sofaInfo ? (sofaInfo.descripcion || sofaInfo.nombre || null) : null;
    const b64 = await processWithOpenAI(imageBuffer, sofaDesc);

    console.log('[IMG] Subiendo resultado a Cloudinary...');
    const cloudinaryUrl = await uploadBase64ToCloudinary(b64);

    return { success: true, imageUrl: cloudinaryUrl };
  } catch (error) {
    console.error('[IMG] Error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { processRoomImage, downloadFromTwilio };
