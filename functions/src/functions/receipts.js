const { requireSession } = require('../lib/sessions');
const { checkRateLimit } = require('../lib/rateLimit');
const { uploadReceiptImage } = require('../lib/storage');
const { classifyReceiptImage } = require('../lib/geminiClient');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

async function classifyReceipt(db, bucket, apiKey, data) {
  const {
    sessionToken, tripId, photoBase64, mimeType,
  } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  // Validate the payload before the rate-limit slot is spent and, more
  // importantly, before the Storage upload and the billable Gemini call.
  if (!photoBase64 || !mimeType) throw new Error('MISSING_FIELDS');
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('INVALID_MIME_TYPE');

  await checkRateLimit(db, sessionToken, 'classifyReceipt', 5, 60000);

  const photoUrl = await uploadReceiptImage(bucket, tripId, photoBase64, mimeType);
  const classification = await classifyReceiptImage(photoBase64, mimeType, apiKey);

  return { photoUrl, ...classification };
}

module.exports = { classifyReceipt, ALLOWED_MIME_TYPES };
