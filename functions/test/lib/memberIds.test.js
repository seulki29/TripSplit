const { FakeFirestore } = require('../helpers/fakeFirestore');
const { assertMemberIdsExist } = require('../../src/lib/memberIds');

async function makeTripWithMembers(db, names) {
  const tripRef = await db.collection('trips').add({ slug: 'a', name: 'A' });
  const ids = [];
  for (const name of names) {
    const ref = await tripRef.collection('members').add({ name, weight: 1 });
    ids.push(ref.id);
  }
  return { tripId: tripRef.id, ids };
}

describe('assertMemberIdsExist', () => {
  test('빈 배열은 통과한다', async () => {
    const db = new FakeFirestore();
    const { tripId } = await makeTripWithMembers(db, ['가']);
    await expect(assertMemberIdsExist(db, tripId, [], 'CODE')).resolves.toBeUndefined();
  });

  test('실재하는 ID는 통과한다', async () => {
    const db = new FakeFirestore();
    const { tripId, ids } = await makeTripWithMembers(db, ['가', '나']);
    await expect(assertMemberIdsExist(db, tripId, ids, 'CODE')).resolves.toBeUndefined();
  });

  test('없는 ID가 하나라도 있으면 주어진 코드로 던진다', async () => {
    const db = new FakeFirestore();
    const { tripId, ids } = await makeTripWithMembers(db, ['가']);
    await expect(
      assertMemberIdsExist(db, tripId, [...ids, 'nope'], 'MY_CODE'),
    ).rejects.toThrow('MY_CODE');
  });

  test('배열이 아니면 주어진 코드로 던진다', async () => {
    const db = new FakeFirestore();
    const { tripId } = await makeTripWithMembers(db, ['가']);
    await expect(assertMemberIdsExist(db, tripId, null, 'MY_CODE')).rejects.toThrow('MY_CODE');
    await expect(assertMemberIdsExist(db, tripId, 'x', 'MY_CODE')).rejects.toThrow('MY_CODE');
  });

  test('다른 여행의 구성원 ID는 통과하지 못한다', async () => {
    const db = new FakeFirestore();
    const a = await makeTripWithMembers(db, ['가']);
    const b = await makeTripWithMembers(db, ['나']);
    await expect(
      assertMemberIdsExist(db, a.tripId, b.ids, 'MY_CODE'),
    ).rejects.toThrow('MY_CODE');
  });
});
