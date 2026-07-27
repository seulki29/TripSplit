const { requireSession } = require('../lib/sessions');
const { checkRateLimit } = require('../lib/rateLimit');
const { uploadReceiptImage, getReceiptReadUrl } = require('../lib/storage');
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

  const photoPath = await uploadReceiptImage(bucket, tripId, photoBase64, mimeType);

  // A classification failure must not discard the uploaded photo: the
  // frontend falls back to manual entry but keeps the receipt attached.
  try {
    const classification = await classifyReceiptImage(photoBase64, mimeType, apiKey);
    return { photoPath, classified: true, ...classification };
  } catch (err) {
    return { photoPath, classified: false };
  }
}

async function getReceiptUrl(db, bucket, data) {
  const { sessionToken, tripId, expenseId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const snap = await db.collection('trips').doc(tripId).collection('expenses').doc(expenseId).get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');
  const { photoPath } = snap.data();
  if (!photoPath) throw new Error('NO_PHOTO');

  const url = await getReceiptReadUrl(bucket, photoPath);
  return { url };
}

module.exports = { classifyReceipt, getReceiptUrl, ALLOWED_MIME_TYPES };
