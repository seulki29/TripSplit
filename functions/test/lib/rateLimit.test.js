const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { checkRateLimit } = require('../../src/lib/rateLimit');

describe('checkRateLimit', () => {
  test('allows calls under the limit', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);
    await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);

    await expect(checkRateLimit(db, token, 'classifyReceipt', 5, 60000)).resolves.toBeUndefined();
  });

  test('rejects the call once the limit is hit within the window', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    for (let i = 0; i < 5; i += 1) {
      await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);
    }

    await expect(checkRateLimit(db, token, 'classifyReceipt', 5, 60000)).rejects.toThrow('RATE_LIMITED');
  });

  test('calls outside the window do not count', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const ref = db.collection('sessions').doc(token);
    const oldTimestamps = Array(5).fill(Date.now() - 120000);
    await ref.update({ rateLimit_classifyReceipt: oldTimestamps });

    await expect(checkRateLimit(db, token, 'classifyReceipt', 5, 60000)).resolves.toBeUndefined();
  });

  test('different actions have independent limits', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    for (let i = 0; i < 5; i += 1) {
      await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);
    }

    await expect(checkRateLimit(db, token, 'addExpense', 5, 60000)).resolves.toBeUndefined();
  });
});
