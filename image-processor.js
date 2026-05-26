require('dotenv').config();
const Replicate = require('replicate');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });

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

async function uploadToCloudinary(imageBuffer, filename) {
  filename = filename || 'room-image';
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'decasa-rooms', public_id: filename + '-' + Date.now() },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    ).end(imageBuffer);
  });
}

async function processWithReplicate(imageUrl, sofaDescription) {
  var prompt = sofaDescription 
    ? 'Add a ' + sofaDescription + ' in this living room. Match lighting, shadows and perspective. Keep realistic proportions and photorealistic quality.'
    : 'Add a modern sofa in this living room. Match lighting, shadows and perspective. Keep realistic proportions.';
  
  const output = await replicate.run(
    'black-forest-labs/flux-kontext-pro',
    {
      input: {
        input_image: imageUrl,
        prompt: prompt,
        aspect_ratio: 'match_input_image'
      }
    }
  );
  
  return output;
}

async function processRoomImage(mediaUrl, sofaInfo) {
  sofaInfo = sofaInfo || null;
  try {
    console.log('Downloading image from Twilio...');
    const imageBuffer = await downloadFromTwilio(mediaUrl);
    
    console.log('Uploading to Cloudinary...');
    const cloudinaryUrl = await uploadToCloudinary(imageBuffer);
    
    console.log('Processing with Replicate...', cloudinaryUrl);
    const sofaDesc = sofaInfo ? (sofaInfo.descripcion || sofaInfo.nombre || null) : null;
    const resultUrl = await processWithReplicate(cloudinaryUrl, sofaDesc);
    
    return { success: true, imageUrl: resultUrl };
  } catch (error) {
    console.error('Error processing image:', error);
    
    // Detect Replicate credit error (402 Payment Required)
    const errorStr = error.message || '';
    const isCreditError = errorStr.includes('402') || errorStr.includes('Insufficient credit') || errorStr.includes('Payment Required');
    
    if (isCreditError) {
      return { 
        success: false, 
        error: 'NO_CREDIT', 
        message: 'Nuestro servicio de IA esta temporalmente no disponible por mantenimiento.' 
      };
    }
    
    return { success: false, error: error.message };
  }
}

module.exports = { processRoomImage, uploadToCloudinary, downloadFromTwilio };
