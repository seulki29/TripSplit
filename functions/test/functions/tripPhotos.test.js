const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');
const { addTripPhoto, listTripPhotos, deleteTripPhoto } = require('../../src/functions/tripPhotos');

async function seed() {
  const db = new FakeFirestore();
  const bucket = makeFakeBucket();
  const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 't1' });
  const { token: memberToken } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
  const { token: otherMemberToken } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm2' });
  return {
    db, bucket, adminToken, memberToken, otherMemberToken,
  };
}

describe('addTripPhoto', () => {
  test('admin upload creates a photo doc with uploadedBy "admin"', async () => {
    const { db, bucket, adminToken } = await seed();
    const { id, photoPath } = await addTripPhoto(db, bucket, {
      sessionToken: adminToken, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    expect(photoPath).toMatch(/^tripPhotos\/t1\/[0-9a-f]{32}\.jpg$/);
    const snap = await db.collection('trips').doc('t1').collection('photos').doc(id).get();
    expect(snap.data().uploadedBy).toBe('admin');
    expect(snap.data().photoPath).toBe(photoPath);
    expect(typeof snap.data().createdAt).toBe('number');
  });

  test('member upload creates a photo doc with uploadedBy = the member\'s id', async () => {
    const { db, bucket, memberToken } = await seed();
    const { id } = await addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    const snap = await db.collection('trips').doc('t1').collection('photos').doc(id).get();
    expect(snap.data().uploadedBy).toBe('m1');
  });

  test('rejects a mimeType outside the allowlist before uploading anything', async () => {
    const { db, bucket, memberToken } = await seed();
    await expect(addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/heic',
    })).rejects.toThrow('INVALID_MIME_TYPE');
    expect(bucket.saved).toHaveLength(0);
  });

  test('rejects a missing photo or mimeType with MISSING_FIELDS', async () => {
    const { db, bucket, memberToken } = await seed();
    await expect(addTripPhoto(db, bucket, { sessionToken: memberToken, tripId: 't1', mimeType: 'image/jpeg' }))
      .rejects.toThrow('MISSING_FIELDS');
  });

  test('succeeds even when the trip is completed (photos are exempt from the edit lock)', async () => {
    const { db, bucket, memberToken } = await seed();
    await db.collection('trips').doc('t1').set({ status: 'completed' });

    await expect(addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).resolves.toBeDefined();
  });

  test('rejects a session scoped to a different trip', async () => {
    const { db, bucket, memberToken } = await seed();
    await expect(addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't2', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).rejects.toThrow('FORBIDDEN');
  });
});

describe('listTripPhotos', () => {
  test('returns photos oldest-first with signed URLs', async () => {
    const { db, bucket, memberToken } = await seed();
    const photosRef = db.collection('trips').doc('t1').collection('photos');
    await photosRef.doc('p2').set({ photoPath: 'tripPhotos/t1/b.jpg', uploadedBy: 'm1', createdAt: 200 });
    await photosRef.doc('p1').set({ photoPath: 'tripPhotos/t1/a.jpg', uploadedBy: 'admin', createdAt: 100 });

    const { photos } = await listTripPhotos(db, bucket, { sessionToken: memberToken, tripId: 't1' });
    expect(photos.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(photos[0].url).toMatch(/^https:\/\/storage\.fake\/tripPhotos\/t1\/a\.jpg/);
    expect(photos[0].uploadedBy).toBe('admin');
  });

  test('returns an empty array when there are no photos', async () => {
    const { db, bucket, memberToken } = await seed();
    const { photos } = await listTripPhotos(db, bucket, { sessionToken: memberToken, tripId: 't1' });
    expect(photos).toEqual([]);
  });
});

describe('deleteTripPhoto', () => {
  async function seedPhoto(db, uploadedBy) {
    const ref = db.collection('trips').doc('t1').collection('photos').doc();
    await ref.set({ photoPath: `tripPhotos/t1/${ref.id}.jpg`, uploadedBy, createdAt: 1 });
    return ref.id;
  }

  test('the uploader can delete their own photo', async () => {
    const { db, bucket, memberToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');

    await expect(deleteTripPhoto(db, bucket, { sessionToken: memberToken, tripId: 't1', photoId })).resolves.toEqual({ ok: true });
    expect((await db.collection('trips').doc('t1').collection('photos').doc(photoId).get()).exists).toBe(false);
  });

  test('an admin can delete any photo', async () => {
    const { db, bucket, adminToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');

    await expect(deleteTripPhoto(db, bucket, { sessionToken: adminToken, tripId: 't1', photoId })).resolves.toEqual({ ok: true });
  });

  test('a different member cannot delete someone else\'s photo', async () => {
    const { db, bucket, otherMemberToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');

    await expect(deleteTripPhoto(db, bucket, { sessionToken: otherMemberToken, tripId: 't1', photoId })).rejects.toThrow('FORBIDDEN');
  });

  test('throws PHOTO_NOT_FOUND for a missing id', async () => {
    const { db, bucket, adminToken } = await seed();
    await expect(deleteTripPhoto(db, bucket, { sessionToken: adminToken, tripId: 't1', photoId: 'nope' }))
      .rejects.toThrow('PHOTO_NOT_FOUND');
  });

  test('succeeds even when the trip is completed', async () => {
    const { db, bucket, memberToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');
    await db.collection('trips').doc('t1').set({ status: 'completed' });

    await expect(deleteTripPhoto(db, bucket, { sessionToken: memberToken, tripId: 't1', photoId })).resolves.toEqual({ ok: true });
  });
});
