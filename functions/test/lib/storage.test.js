const { makeFakeBucket } = require('../helpers/fakeBucket');
const { uploadReceiptImage, SIGNED_URL_TTL_MS } = require('../../src/lib/storage');

describe('uploadReceiptImage', () => {
  test('saves the image under the trip and returns a signed URL', async () => {
    const bucket = makeFakeBucket();
    const url = await uploadReceiptImage(bucket, 'trip1', Buffer.from('fake-image').toString('base64'), 'image/jpeg');

    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/trip1\//);
    expect(url).toContain('?expires=');
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].opts.metadata.contentType).toBe('image/jpeg');
  });

  test('does not make the uploaded object public', async () => {
    const bucket = makeFakeBucket();
    await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/jpeg');

    expect(bucket.saved[0].opts).not.toHaveProperty('public');
    expect(Object.keys(bucket.saved[0].opts)).toEqual(['metadata']);
  });

  test('the signed URL expires roughly seven days out', async () => {
    const bucket = makeFakeBucket();
    const before = Date.now();
    const url = await uploadReceiptImage(bucket, 'trip1', 'eA==', 'image/jpeg');

    const expires = Number(new URL(url).searchParams.get('expires'));
    expect(expires).toBeGreaterThanOrEqual(before + SIGNED_URL_TTL_MS);
    expect(expires).toBeLessThanOrEqual(Date.now() + SIGNED_URL_TTL_MS);
  });

  test('uses a .png extension for png images', async () => {
    const bucket = makeFakeBucket();
    await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/png');
    expect(bucket.saved[0].path).toMatch(/\.png$/);
  });

  test('uses a .jpg extension for jpeg images', async () => {
    const bucket = makeFakeBucket();
    await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/jpeg');
    expect(bucket.saved[0].path).toMatch(/\.jpg$/);
  });

  test('generates a unique, unguessable filename on every call', async () => {
    const bucket = makeFakeBucket();
    for (let i = 0; i < 20; i += 1) {
      await uploadReceiptImage(bucket, 'trip1', 'eA==', 'image/jpeg');
    }

    const paths = bucket.saved.map((s) => s.path);
    expect(new Set(paths).size).toBe(20);
    // 16 random bytes rendered as hex, not a timestamp.
    expect(paths[0]).toMatch(/^receipts\/trip1\/[0-9a-f]{32}\.jpg$/);
  });
});
