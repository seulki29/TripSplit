const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const {
  listSchedules, addSchedule, updateSchedule, deleteSchedule,
} = require('../../src/functions/schedules');

async function setup(db, { status = 'active' } = {}) {
  const tripRef = await db.collection('trips').add({
    slug: 'a', name: 'A', group: 'G', status, adminPinHash: 'x', memberPinHash: 'y',
  });
  const m1 = await tripRef.collection('members').add({ name: '가', weight: 1 });
  const m2 = await tripRef.collection('members').add({ name: '나', weight: 1 });
  const member = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m1.id });
  const admin = await createSession(db, { role: 'admin', tripId: tripRef.id });
  return {
    tripId: tripRef.id, m1: m1.id, m2: m2.id, memberToken: member.token, adminToken: admin.token,
  };
}

function validEntry(t, over = {}) {
  return {
    sessionToken: t.memberToken,
    tripId: t.tripId,
    planId: 'default',
    title: '성산일출봉',
    detail: '입장료 5천원',
    category: '놀이',
    placeName: '성산일출봉',
    date: '2026-08-02',
    startMin: 660,
    endMin: 780,
    participants: [t.m1, t.m2],
    ...over,
  };
}

// Helper that calls listSchedules first so plans/default exists.
async function withPlan(db, t) {
  await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
}

describe('listSchedules', () => {
  test('처음 호출하면 plans/default를 만든다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const result = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('default');
    expect(result.plans[0].name).toBe('1안');
    expect(result.schedules).toEqual([]);
  });

  // If we overwrote with merge:true on every call, createdAt would be
  // refreshed on every tab open, and a renamed plan would revert to '1안'
  // on the next fetch.
  test('두 번 호출해도 plan은 하나이고 내용이 보존된다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const first = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    const createdAt = first.plans[0].createdAt;

    await db.collection('trips').doc(t.tripId).collection('plans').doc('default')
      .update({ name: '2안' });

    const second = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(second.plans).toHaveLength(1);
    expect(second.plans[0].name).toBe('2안');
    expect(second.plans[0].createdAt).toBe(createdAt);
  });

  test('완료된 여행에서도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db, { status: 'completed' });
    const result = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(result.plans).toHaveLength(1);
  });

  test('저장된 일정을 돌려준다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await addSchedule(db, validEntry(t));
    const result = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].title).toBe('성산일출봉');
    expect(result.schedules[0].id).toBeDefined();
  });

  test('다른 여행의 세션은 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { token } = await createSession(db, { role: 'member', tripId: 'other', memberId: 'x' });
    await expect(listSchedules(db, { sessionToken: token, tripId: t.tripId })).rejects.toThrow('FORBIDDEN');
  });

  test('세션이 없으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(listSchedules(db, { tripId: t.tripId })).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('addSchedule', () => {
  test('멤버 세션이면 createdBy에 memberId가 들어간다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().createdBy).toBe(t.m1);
    expect(snap.data().createdByRole).toBe('member');
    expect(snap.data().planId).toBe('default');
  });

  // An admin session has memberId === null (see tripAuth.verifyAdminPin).
  test('관리자 세션이면 createdBy가 null이고 role이 admin', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t, { sessionToken: t.adminToken }));

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().createdBy).toBeNull();
    expect(snap.data().createdByRole).toBe('admin');
  });

  test('완료된 여행에서는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db, { status: 'completed' });
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t))).rejects.toThrow('TRIP_COMPLETED');
  });

  test('없는 plan이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(addSchedule(db, validEntry(t, { planId: 'nope' }))).rejects.toThrow('PLAN_NOT_FOUND');
  });

  test('제목이 비면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { title: '' }))).rejects.toThrow('TITLE_REQUIRED');
    await expect(addSchedule(db, validEntry(t, { title: '   ' }))).rejects.toThrow('TITLE_REQUIRED');
  });

  test('제목이 100자를 넘으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { title: 'ㄱ'.repeat(101) }))).rejects.toThrow('TITLE_REQUIRED');
  });

  test('세부가 500자를 넘으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { detail: 'ㄱ'.repeat(501) })),
    ).rejects.toThrow('SCHEDULE_TEXT_TOO_LONG');
  });

  test('없는 카테고리면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { category: '없음' }))).rejects.toThrow('INVALID_CATEGORY');
  });

  test('날짜 형식이 틀리면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { date: '2026/08/02' }))).rejects.toThrow('INVALID_SCHEDULE_DATE');
  });

  test('끝 시간이 시작 시간보다 뒤가 아니면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { startMin: 660, endMin: 660 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
    await expect(
      addSchedule(db, validEntry(t, { startMin: 660, endMin: 600 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  test('시간이 0-1440 범위를 벗어나면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { startMin: -1, endMin: 600 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
    await expect(
      addSchedule(db, validEntry(t, { startMin: 600, endMin: 1441 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  test('한쪽만 null이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { startMin: 660, endMin: null })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  // A time without a date is meaningless — there's no way to know which
  // day's 11am it refers to.
  test('날짜가 null인데 시간이 있으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { date: null, startMin: 660, endMin: 780 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  test('날짜도 시간도 null이면 통과한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(
      db, validEntry(t, { date: null, startMin: null, endMin: null }),
    );
    expect(scheduleId).toBeDefined();
  });

  test('날짜만 있고 시간이 null이면 통과한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(
      db, validEntry(t, { startMin: null, endMin: null }),
    );
    expect(scheduleId).toBeDefined();
  });

  test('실재하지 않는 참여자는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { participants: [t.m1, 'nope'] })),
    ).rejects.toThrow('INVALID_PARTICIPANTS');
  });

  test('참여자 중복을 제거해 저장한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t, { participants: [t.m1, t.m1, t.m2] }));
    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().participants).toEqual([t.m1, t.m2]);
  });
});

describe('updateSchedule', () => {
  test('남이 만든 일정도 수정할 수 있다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    // m1 (memberToken) creates it
    const { scheduleId } = await addSchedule(db, validEntry(t));
    // m2 edits it
    const other = await createSession(db, { role: 'member', tripId: t.tripId, memberId: t.m2 });

    await updateSchedule(db, {
      sessionToken: other.token, tripId: t.tripId, scheduleId, patch: { title: '우도' },
    });

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().title).toBe('우도');
    expect(snap.data().updatedBy).toBe(t.m2);
    expect(snap.data().updatedByRole).toBe('member');
  });

  test('patch에 없는 필드는 건드리지 않는다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));

    await updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { title: '우도' },
    });

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().detail).toBe('입장료 5천원');
    expect(snap.data().startMin).toBe(660);
  });

  test('patch도 검증한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { category: '없음' },
    })).rejects.toThrow('INVALID_CATEGORY');

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { startMin: 700, endMin: 600 },
    })).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  // Patching only one side of the time range must be validated together
  // with the stored other side.
  test('시간을 한쪽만 patch하면 기존 값과 함께 검증한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t)); // 660-780

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { endMin: 600 },
    })).rejects.toThrow('INVALID_SCHEDULE_TIME');

    await updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { endMin: 900 },
    });
    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().endMin).toBe(900);
  });

  test('완료된 여행에서는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));
    await db.collection('trips').doc(t.tripId).update({ status: 'completed' });

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { title: '우도' },
    })).rejects.toThrow('TRIP_COMPLETED');
  });

  test('없는 일정이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId: 'nope', patch: { title: 'x' },
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });
});

describe('deleteSchedule', () => {
  test('남이 만든 일정도 삭제할 수 있다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));
    const other = await createSession(db, { role: 'member', tripId: t.tripId, memberId: t.m2 });

    await deleteSchedule(db, { sessionToken: other.token, tripId: t.tripId, scheduleId });

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.exists).toBe(false);
  });

  test('완료된 여행에서는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));
    await db.collection('trips').doc(t.tripId).update({ status: 'completed' });

    await expect(deleteSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId,
    })).rejects.toThrow('TRIP_COMPLETED');
  });

  test('없는 일정이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(deleteSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId: 'nope',
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });
});
