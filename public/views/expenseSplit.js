import { minToLabel } from '../scheduleLayout.js';

// The backend stores who is EXCLUDED from an expense; the UI shows who is
// SHARING it, because that is how people think about splitting a bill. The
// inversion happens here, once, at the boundary.
//
// Order follows `members` rather than click order so the same selection always
// serialises to the same array -- otherwise two identical splits produce
// different documents and diffs become meaningless.
function excludedFrom(members, includedIds) {
  const included = new Set(includedIds);
  return members.filter((m) => !included.has(m.id)).map((m) => m.id);
}

// Expenses always carry a date, so a schedule with none has nothing to offer
// and is left out of the picker entirely.
function groupSchedulesForPicker(schedules) {
  const byDate = new Map();
  for (const s of schedules) {
    if (!s.date) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  return [...byDate.keys()].sort().map((date) => ({
    date,
    items: byDate.get(date)
      .slice()
      // Undated entries sort to the end of their day, matching how the
      // timetable's untimed strip sits above the day rather than inside it.
      .sort((a, b) => {
        const am = typeof a.startMin === 'number' ? a.startMin : 1440;
        const bm = typeof b.startMin === 'number' ? b.startMin : 1440;
        return am - bm;
      })
      .map((s) => {
        // Guard the title against undefined/null values. A schedule is still
        // valid even without a title (unlike a waypoint with no place name).
        const titleStr = String(s.title ?? '').trim();
        const timeLabel = typeof s.startMin === 'number' ? minToLabel(s.startMin) : '시간미정';
        return {
          id: s.id,
          label: titleStr ? `${timeLabel} ${titleStr}` : timeLabel,
        };
      }),
  }));
}

export { excludedFrom, groupSchedulesForPicker };
