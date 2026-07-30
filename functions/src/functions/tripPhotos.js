const { requireSession } = require('../lib/sessions');
const { uploadTripPhotoImage, getReceiptReadUrl } = require('../lib/storage');
const { ALLOWED_MIME_TYPES } = require('./receipts');

async function addTripPhoto(db, bucket, data) {
  const {
    sessionToken, tripId, photoBase64, mimeType,
  } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  if (!photoBase64 || !mimeType) throw new Error('MISSING_FIELDS');
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('INVALID_MIME_TYPE');

  const photoPath = await uploadTripPhotoImage(bucket, tripId, photoBase64, mimeType);
  const ref = await db.collection('trips').doc(tripId).collection('photos').add({
    photoPath,
    uploadedBy: session.memberId ?? 'admin',
    createdAt: Date.now(),
  });
  return { id: ref.id, photoPath };
}

async function listTripPhotos(db, bucket, data) {
  const { sessionToken, tripId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const snap = await db.collection('trips').doc(tripId).collection('photos').get();
  const photos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.createdAt - b.createdAt);

  const withUrls = await Promise.all(photos.map(async (p) => ({
    id: p.id,
    uploadedBy: p.uploadedBy,
    createdAt: p.createdAt,
    url: await getReceiptReadUrl(bucket, p.photoPath),
  })));
  return { photos: withUrls };
}

async function deleteTripPhoto(db, bucket, data) {
  const { sessionToken, tripId, photoId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const ref = db.collection('trips').doc(tripId).collection('photos').doc(photoId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('PHOTO_NOT_FOUND');
  const photo = snap.data();

  if (session.role === 'member' && photo.uploadedBy !== session.memberId) throw new Error('FORBIDDEN');

  // Best-effort: a storage failure must never block the doc delete.
  if (photo.photoPath) {
    await bucket.file(photo.photoPath).delete().catch(() => {});
  }
  await ref.delete();
  return { ok: true };
}

module.exports = { addTripPhoto, listTripPhotos, deleteTripPhoto };
