function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

async function uploadReceiptImage(bucket, tripId, base64, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const filePath = `receipts/${tripId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(base64ToBuffer(base64), { metadata: { contentType: mimeType }, public: true });
  return file.publicUrl();
}

module.exports = { uploadReceiptImage, base64ToBuffer };
