const crypto = require('crypto');

const READ_URL_TTL_MS = 15 * 60 * 1000;

function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

/**
 * Uploads a receipt as a PRIVATE object and returns its storage PATH. The
 * object name is cryptographically random so receipts cannot be enumerated
 * by guessing timestamps. Signed URLs are minted at read time by
 * getReceiptReadUrl so stored references never expire.
 */
async function uploadReceiptImage(bucket, tripId, base64, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const filePath = `receipts/${tripId}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(base64ToBuffer(base64), { metadata: { contentType: mimeType } });
  return filePath;
}

async function getReceiptReadUrl(bucket, path) {
  // The Storage emulator has no signing credentials, so getSignedUrl hangs
  // trying to reach a metadata server. Serve the emulator's JSON-API
  // download endpoint instead; production keeps real signed URLs.
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
  if (emulatorHost) {
    const host = emulatorHost.replace(/^https?:\/\//, '');
    return `http://${host}/download/storage/v1/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
  }
  const [url] = await bucket.file(path).getSignedUrl({ action: 'read', expires: Date.now() + READ_URL_TTL_MS });
  return url;
}

module.exports = { uploadReceiptImage, getReceiptReadUrl, base64ToBuffer, READ_URL_TTL_MS };
