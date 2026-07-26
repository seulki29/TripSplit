const crypto = require('crypto');

const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

/**
 * Uploads a receipt as a PRIVATE object and hands back a time-limited signed
 * URL. The object name is cryptographically random so receipts cannot be
 * enumerated by guessing timestamps.
 */
async function uploadReceiptImage(bucket, tripId, base64, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const filePath = `receipts/${tripId}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(base64ToBuffer(base64), { metadata: { contentType: mimeType } });
  const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS });
  return url;
}

module.exports = { uploadReceiptImage, base64ToBuffer, SIGNED_URL_TTL_MS };
