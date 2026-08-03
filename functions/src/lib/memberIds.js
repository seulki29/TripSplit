/**
 * 주어진 ID들이 전부 이 여행의 구성원인지 확인한다.
 *
 * 던지는 에러 코드를 호출자가 정하는 이유: 같은 검사지만 사용자에게 나가는
 * 문구가 다르다. 경비는 "제외 구성원 선택이 올바르지 않습니다",
 * 일정은 "참여자 선택이 올바르지 않습니다".
 */
async function assertMemberIdsExist(db, tripId, ids, errorCode) {
  if (!Array.isArray(ids)) throw new Error(errorCode);
  if (ids.length === 0) return;
  const membersRef = db.collection('trips').doc(tripId).collection('members');
  const snaps = await Promise.all(ids.map((id) => membersRef.doc(id).get()));
  if (snaps.some((s) => !s.exists)) throw new Error(errorCode);
}

module.exports = { assertMemberIdsExist };
