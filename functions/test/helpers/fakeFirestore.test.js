const { FakeFirestore } = require('./fakeFirestore');

describe('FakeFirestore', () => {
  test('set and get a document', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ name: 'Yeongwol' });
    const snap = await db.collection('trips').doc('t1').get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ name: 'Yeongwol' });
  });

  test('add() generates an id readable via the returned ref', async () => {
    const db = new FakeFirestore();
    const ref = await db.collection('trips').add({ name: 'Auto' });
    const snap = await ref.get();
    expect(snap.data()).toEqual({ name: 'Auto' });
  });

  test('subcollection documents do not leak into the parent collection query', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ name: 'Yeongwol' });
    await db.collection('trips').doc('t1').collection('members').doc('m1').set({ name: '슬기' });

    const tripDocs = await db.collection('trips').get();
    expect(tripDocs.docs).toHaveLength(1);

    const memberDocs = await db.collection('trips').doc('t1').collection('members').get();
    expect(memberDocs.docs).toHaveLength(1);
    expect(memberDocs.docs[0].data()).toEqual({ name: '슬기' });
  });

  test('where() filters by equality and chains', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ slug: 'a', status: 'active' });
    await db.collection('trips').doc('t2').set({ slug: 'b', status: 'completed' });
    await db.collection('trips').doc('t3').set({ slug: 'c', status: 'completed' });

    const result = await db.collection('trips').where('status', '==', 'completed').get();
    expect(result.docs.map((d) => d.id).sort()).toEqual(['t2', 't3']);
  });

  test('runTransaction exposes get/set/update and the writes survive the transaction', async () => {
    const db = new FakeFirestore();
    await db.collection('counters').doc('c1').set({ count: 1, label: 'first' });

    const ref = db.collection('counters').doc('c1');
    const seen = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      tx.update(ref, { count: snap.data().count + 1 });
      tx.set(db.collection('counters').doc('c2'), { count: 99 });
      return snap.data().label;
    });

    expect(seen).toBe('first');
    expect((await db.collection('counters').doc('c1').get()).data()).toEqual({ count: 2, label: 'first' });
    expect((await db.collection('counters').doc('c2').get()).data()).toEqual({ count: 99 });
  });

  test('runTransaction reports a missing document as not existing', async () => {
    const db = new FakeFirestore();
    const exists = await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.collection('counters').doc('nope'));
      return snap.exists;
    });
    expect(exists).toBe(false);
  });

  test('runTransaction propagates an error thrown inside the callback', async () => {
    const db = new FakeFirestore();
    await expect(db.runTransaction(async () => {
      throw new Error('BOOM');
    })).rejects.toThrow('BOOM');
  });

  test('recursiveDelete removes a document and everything nested under it', async () => {
    const db = new FakeFirestore();
    const tripRef = db.collection('trips').doc('t1');
    await tripRef.set({ name: 'Yeongwol' });
    await tripRef.collection('members').doc('m1').set({ name: '슬기' });

    await db.recursiveDelete(tripRef);

    const snap = await tripRef.get();
    expect(snap.exists).toBe(false);
    const members = await tripRef.collection('members').get();
    expect(members.docs).toHaveLength(0);
  });
});
