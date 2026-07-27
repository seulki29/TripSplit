const { makeFakeBucket } = require('../helpers/fakeBucket');
const { uploadReceiptImage, getReceiptReadUrl, READ_URL_TTL_MS } = require('../../src/lib/storage');

describe('uploadReceiptImage', () => {
  test('saves the image under the trip and returns the object path', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadReceiptImage(bucket, 'trip1', Buffer.from('fake-image').toString('base64'), 'image/jpeg');

    expect(path).toMatch(/^receipts\/trip1\/[0-9a-f]{32}\.jpg$/);
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].path).toBe(path);
    expect(bucket.saved[0].opts.metadata.contentType).toBe('image/jpeg');
  });

  test('does not make the uploaded object public', async () => {
    const bucket = makeFakeBucket();
    await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/jpeg');

    expect(bucket.saved[0].opts).not.toHaveProperty('public');
    expect(Object.keys(bucket.saved[0].opts)).toEqual(['metadata']);
  });

  test('uses a .png extension for png images', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/png');
    expect(path).toMatch(/\.png$/);
  });

  test('uses a .jpg extension for jpeg images', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/jpeg');
    expect(path).toMatch(/\.jpg$/);
  });
});

describe('getReceiptReadUrl', () => {
  beforeEach(() => {
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  });

  test('mints a signed URL for the given path with a 15-minute expiry', async () => {
    const bucket = makeFakeBucket();
    const before = Date.now();
    const url = await getReceiptReadUrl(bucket, 'receipts/trip1/abc.jpg');

    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/trip1\/abc\.jpg\?expires=/);
    const expires = Number(new URL(url).searchParams.get('expires'));
    expect(expires).toBeGreaterThanOrEqual(before + READ_URL_TTL_MS);
    expect(expires).toBeLessThanOrEqual(Date.now() + READ_URL_TTL_MS);
  });

  test('serves the emulator download endpoint when FIREBASE_STORAGE_EMULATOR_HOST is set', async () => {
    const bucket = makeFakeBucket();
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
    try {
      const url = await getReceiptReadUrl(bucket, 'receipts/trip1/abc.jpg');
      expect(url).toBe('http://127.0.0.1:9199/download/storage/v1/b/fake-bucket/o/receipts%2Ftrip1%2Fabc.jpg?alt=media');
    } finally {
      delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    }
  });
});
