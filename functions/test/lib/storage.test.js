const { makeFakeBucket } = require('../helpers/fakeBucket');
const { uploadReceiptImage } = require('../../src/lib/storage');

describe('uploadReceiptImage', () => {
  test('saves the image under the trip and returns its public URL', async () => {
    const bucket = makeFakeBucket();
    const url = await uploadReceiptImage(bucket, 'trip1', Buffer.from('fake-image').toString('base64'), 'image/jpeg');

    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/trip1\//);
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].opts.metadata.contentType).toBe('image/jpeg');
  });

  test('uses a .png extension for png images', async () => {
    const bucket = makeFakeBucket();
    const url = await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/png');
    expect(url).toMatch(/\.png$/);
  });
});
