const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');

jest.mock('../../src/lib/geminiClient', () => ({
  classifyReceiptImage: jest.fn().mockResolvedValue({
    category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수',
  }),
}));

const { classifyReceipt } = require('../../src/functions/receipts');

describe('classifyReceipt', () => {
  test('uploads the photo and returns the Gemini classification alongside the photo URL', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const result = await classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken: token, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    expect(result.category).toBe('식비');
    expect(result.photoUrl).toMatch(/^https:\/\/storage\.fake\/receipts\/t1\//);
    expect(bucket.saved).toHaveLength(1);
  });

  test('is rate-limited after 5 calls within a minute', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const call = () => classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken: token, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    });

    for (let i = 0; i < 5; i += 1) await call();

    await expect(call()).rejects.toThrow('RATE_LIMITED');
  });

  test('rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken: token, tripId: 't2', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).rejects.toThrow('FORBIDDEN');
  });
});
