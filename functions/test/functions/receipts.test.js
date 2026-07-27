const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');

jest.mock('../../src/lib/geminiClient', () => ({
  classifyReceiptImage: jest.fn().mockResolvedValue({
    category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수',
  }),
}));

const { classifyReceiptImage } = require('../../src/lib/geminiClient');
const { classifyReceipt, getReceiptUrl } = require('../../src/functions/receipts');

async function seed() {
  const db = new FakeFirestore();
  const bucket = makeFakeBucket();
  const { token: sessionToken } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
  return { db, bucket, sessionToken };
}

describe('classifyReceipt', () => {
  test('uploads the photo and returns the Gemini classification alongside the photo path', async () => {
    const { db, bucket, sessionToken } = await seed();

    const result = await classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    expect(result.classified).toBe(true);
    expect(result.category).toBe('식비');
    expect(result.photoPath).toMatch(/^receipts\/t1\/[0-9a-f]{32}\.jpg$/);
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].opts).not.toHaveProperty('public');
  });

  test('returns photoPath with classified:false when Gemini classification fails', async () => {
    const { db, bucket, sessionToken } = await seed();
    classifyReceiptImage.mockRejectedValueOnce(new Error('GEMINI_HTTP_500'));

    const result = await classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't1', photoBase64: Buffer.from('x').toString('base64'), mimeType: 'image/jpeg',
    });

    expect(result.classified).toBe(false);
    expect(result.photoPath).toMatch(/^receipts\/t1\/[0-9a-f]{32}\.jpg$/);
    expect(bucket.saved).toHaveLength(1); // the upload was kept
  });

  test('rejects a mimeType outside the allowlist before uploading anything', async () => {
    const { db, bucket, sessionToken } = await seed();

    for (const mimeType of ['image/svg+xml', 'application/pdf', 'text/html', 'image/heic']) {
      await expect(classifyReceipt(db, bucket, 'fake-api-key', {
        sessionToken, tripId: 't1', photoBase64: 'aW1n', mimeType,
      })).rejects.toThrow('INVALID_MIME_TYPE');
    }

    expect(bucket.saved).toHaveLength(0);
  });

  test('accepts both allowlisted image types', async () => {
    const { db, bucket, sessionToken } = await seed();

    for (const mimeType of ['image/jpeg', 'image/png']) {
      await expect(classifyReceipt(db, bucket, 'fake-api-key', {
        sessionToken, tripId: 't1', photoBase64: 'aW1n', mimeType,
      })).resolves.toBeDefined();
    }

    expect(bucket.saved.map((s) => s.opts.metadata.contentType)).toEqual(['image/jpeg', 'image/png']);
  });

  test('is rate-limited after 5 calls within a minute', async () => {
    const { db, bucket, sessionToken } = await seed();
    const call = () => classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    });

    for (let i = 0; i < 5; i += 1) await call();

    await expect(call()).rejects.toThrow('RATE_LIMITED');
  });

  test('rejects a missing photo or mimeType with MISSING_FIELDS, not a TypeError', async () => {
    const { db, bucket, sessionToken } = await seed();

    await expect(classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't1', mimeType: 'image/jpeg',
    })).rejects.toThrow('MISSING_FIELDS');

    await expect(classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't1', photoBase64: 'aW1n',
    })).rejects.toThrow('MISSING_FIELDS');

    expect(bucket.saved).toHaveLength(0);
  });

  test('a malformed payload is rejected before it can spend a rate-limit slot', async () => {
    const { db, bucket, sessionToken } = await seed();

    for (let i = 0; i < 10; i += 1) {
      await expect(classifyReceipt(db, bucket, 'fake-api-key', {
        sessionToken, tripId: 't1', mimeType: 'image/jpeg',
      })).rejects.toThrow('MISSING_FIELDS');
    }

    await expect(classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).resolves.toBeDefined();
  });

  test('rejects a session scoped to a different trip', async () => {
    const { db, bucket, sessionToken } = await seed();

    await expect(classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken, tripId: 't2', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).rejects.toThrow('FORBIDDEN');
  });
});

describe('getReceiptUrl', () => {
  test('returns a signed URL for an expense with a photo', async () => {
    const { db, bucket, sessionToken } = await seed();
    await db.collection('trips').doc('t1').collection('expenses').doc('e1')
      .set({ photoPath: 'receipts/t1/abc.jpg' });

    const { url } = await getReceiptUrl(db, bucket, { sessionToken, tripId: 't1', expenseId: 'e1' });
    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/t1\/abc\.jpg\?expires=/);
  });

  test('rejects EXPENSE_NOT_FOUND for a missing expense', async () => {
    const { db, bucket, sessionToken } = await seed();

    await expect(getReceiptUrl(db, bucket, { sessionToken, tripId: 't1', expenseId: 'nope' }))
      .rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('rejects NO_PHOTO when the expense has no photoPath', async () => {
    const { db, bucket, sessionToken } = await seed();
    await db.collection('trips').doc('t1').collection('expenses').doc('e2')
      .set({ photoPath: null });

    await expect(getReceiptUrl(db, bucket, { sessionToken, tripId: 't1', expenseId: 'e2' }))
      .rejects.toThrow('NO_PHOTO');
  });

  test('rejects UNAUTHENTICATED without a valid session', async () => {
    const { db, bucket } = await seed();

    await expect(getReceiptUrl(db, bucket, { sessionToken: 'bogus', tripId: 't1', expenseId: 'e1' }))
      .rejects.toThrow('UNAUTHENTICATED');
  });

  test('rejects a session scoped to a different trip', async () => {
    const { db, bucket, sessionToken } = await seed(); // session belongs to t1
    await db.collection('trips').doc('t2').collection('expenses').doc('e9')
      .set({ photoPath: 'receipts/t2/zzz.jpg' });

    await expect(getReceiptUrl(db, bucket, { sessionToken, tripId: 't2', expenseId: 'e9' }))
      .rejects.toThrow('FORBIDDEN');
  });
});
