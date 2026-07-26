const { FakeFirestore } = require('../helpers/fakeFirestore');
const { checkLoginThrottle, resetLoginThrottle, throttleDocId } = require('../../src/lib/loginThrottle');

describe('checkLoginThrottle', () => {
  test('allows attempts under the limit', async () => {
    const db = new FakeFirestore();

    for (let i = 0; i < 9; i += 1) {
      await checkLoginThrottle(db, 'admin:sfa-2026');
    }

    await expect(checkLoginThrottle(db, 'admin:sfa-2026')).resolves.toBeUndefined();
  });

  test('rejects once the limit is reached within the window', async () => {
    const db = new FakeFirestore();

    for (let i = 0; i < 10; i += 1) {
      await checkLoginThrottle(db, 'admin:sfa-2026');
    }

    await expect(checkLoginThrottle(db, 'admin:sfa-2026')).rejects.toThrow('TOO_MANY_ATTEMPTS');
  });

  test('honours a custom limit', async () => {
    const db = new FakeFirestore();

    await checkLoginThrottle(db, 'roster:sfa-2026', 2);
    await checkLoginThrottle(db, 'roster:sfa-2026', 2);

    await expect(checkLoginThrottle(db, 'roster:sfa-2026', 2)).rejects.toThrow('TOO_MANY_ATTEMPTS');
  });

  test('a window that has expired resets the count', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 10; i += 1) {
      await checkLoginThrottle(db, 'admin:sfa-2026');
    }
    await expect(checkLoginThrottle(db, 'admin:sfa-2026')).rejects.toThrow('TOO_MANY_ATTEMPTS');

    // Age the window out (15 minutes + 1 second ago).
    await db.collection('loginAttempts').doc('admin:sfa-2026')
      .update({ windowStart: Date.now() - (15 * 60 * 1000) - 1000 });

    await expect(checkLoginThrottle(db, 'admin:sfa-2026')).resolves.toBeUndefined();
    const snap = await db.collection('loginAttempts').doc('admin:sfa-2026').get();
    expect(snap.data().count).toBe(1);
  });

  test('different keys have independent limits', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 10; i += 1) {
      await checkLoginThrottle(db, 'admin:trip-a');
    }

    await expect(checkLoginThrottle(db, 'admin:trip-a')).rejects.toThrow('TOO_MANY_ATTEMPTS');
    await expect(checkLoginThrottle(db, 'admin:trip-b')).resolves.toBeUndefined();
    await expect(checkLoginThrottle(db, 'member:trip-a:슬기')).resolves.toBeUndefined();
  });

  test('the window start is not extended by later attempts inside the same window', async () => {
    const db = new FakeFirestore();
    await checkLoginThrottle(db, 'admin:sfa-2026');
    const firstStart = (await db.collection('loginAttempts').doc('admin:sfa-2026').get()).data().windowStart;

    await checkLoginThrottle(db, 'admin:sfa-2026');
    const secondStart = (await db.collection('loginAttempts').doc('admin:sfa-2026').get()).data().windowStart;

    expect(secondStart).toBe(firstStart);
  });
});

describe('throttle document ids', () => {
  test("a member name containing '/' still produces a legal, single-segment document id", async () => {
    const db = new FakeFirestore();
    const key = 'member:sfa-2026:a/b';

    await checkLoginThrottle(db, key);

    expect(throttleDocId(key)).toBe('member:sfa-2026:a%2Fb');
    expect(throttleDocId(key)).not.toContain('/');
    const ids = [...db.data.keys()].filter((p) => p.startsWith('loginAttempts/'));
    expect(ids).toEqual(['loginAttempts/member:sfa-2026:a%2Fb']);
  });

  test('the encoding is collision-free between a literal slash and a literal %2F', async () => {
    const db = new FakeFirestore();

    for (let i = 0; i < 10; i += 1) {
      await checkLoginThrottle(db, 'member:t:a/b');
    }

    await expect(checkLoginThrottle(db, 'member:t:a/b')).rejects.toThrow('TOO_MANY_ATTEMPTS');
    await expect(checkLoginThrottle(db, 'member:t:a%2Fb')).resolves.toBeUndefined();
  });

  test('resetLoginThrottle clears the same encoded id that checkLoginThrottle wrote', async () => {
    const db = new FakeFirestore();
    const key = 'member:sfa-2026:a/b';
    for (let i = 0; i < 10; i += 1) {
      await checkLoginThrottle(db, key);
    }

    await resetLoginThrottle(db, key);

    await expect(checkLoginThrottle(db, key)).resolves.toBeUndefined();
  });
});

describe('resetLoginThrottle', () => {
  test('clears the counter so attempts are allowed again at the old limit boundary', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 9; i += 1) {
      await checkLoginThrottle(db, 'admin:sfa-2026');
    }

    await resetLoginThrottle(db, 'admin:sfa-2026');

    // Without the reset this 10th call would leave the counter at the limit and
    // the 11th would throw. After the reset the counter starts from zero again.
    for (let i = 0; i < 10; i += 1) {
      await expect(checkLoginThrottle(db, 'admin:sfa-2026')).resolves.toBeUndefined();
    }
    await expect(checkLoginThrottle(db, 'admin:sfa-2026')).rejects.toThrow('TOO_MANY_ATTEMPTS');
  });

  test('resetting a key that was never used is a no-op', async () => {
    const db = new FakeFirestore();
    await expect(resetLoginThrottle(db, 'admin:never-seen')).resolves.toBeUndefined();
  });

  test('only clears the key it is given', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 10; i += 1) {
      await checkLoginThrottle(db, 'admin:trip-a');
    }

    await resetLoginThrottle(db, 'admin:trip-b');

    await expect(checkLoginThrottle(db, 'admin:trip-a')).rejects.toThrow('TOO_MANY_ATTEMPTS');
  });
});
