import { minToLabel } from '../scheduleLayout.js';
import { escapeHtml } from '../ui.js';
import { formatDate } from '../format.js';

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

/**
 * Renders the schedule picker and the share-list into `container`, and returns
 * accessors the host modal reads at submit time.
 *
 * The picker is omitted entirely when the trip has no dated schedules -- an
 * empty dropdown is worse than no dropdown. The share-list always renders.
 */
function mountExpenseSplit(container, {
  members, schedules, scheduleId = null, excludedMembers = [],
}) {
  const groups = groupSchedulesForPicker(schedules);
  const excluded = new Set(excludedMembers);
  const included = new Set(members.filter((m) => !excluded.has(m.id)).map((m) => m.id));
  let currentScheduleId = scheduleId;
  let pickHandler = null;

  container.innerHTML = `
    ${groups.length ? `
    <div class="field"><label class="label">일정</label>
      <select class="input" id="xs-schedule">
        <option value="">(연결 안 함)</option>
        ${groups.map((g) => `<optgroup label="${escapeHtml(formatDate(g.date))}">
          ${g.items.map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.label)}</option>`).join('')}
        </optgroup>`).join('')}
      </select>
    </div>` : ''}
    <div class="field"><label class="label">분담 인원</label><div id="xs-members"></div></div>`;

  function renderMembers() {
    const all = members.length > 0 && members.every((m) => included.has(m.id));
    container.querySelector('#xs-members').innerHTML = `
      <label class="check-inline"><input type="checkbox" id="xs-all" ${all ? 'checked' : ''}> <strong>전체</strong></label>
      ${members.map((m) => `
        <label class="check-inline">
          <input type="checkbox" class="xs-m" data-id="${escapeHtml(m.id)}" ${included.has(m.id) ? 'checked' : ''}>
          ${escapeHtml(m.name)}
        </label>`).join('')}`;

    container.querySelector('#xs-all').addEventListener('change', (ev) => {
      included.clear();
      if (ev.target.checked) members.forEach((m) => included.add(m.id));
      renderMembers();
    });
    container.querySelectorAll('.xs-m').forEach((box) => {
      box.addEventListener('change', () => {
        if (box.checked) included.add(box.dataset.id);
        else included.delete(box.dataset.id);
        renderMembers();
      });
    });
  }
  renderMembers();

  const sel = container.querySelector('#xs-schedule');
  if (sel) {
    // A stored scheduleId can be missing from the picker -- the schedule was
    // deleted, or its date was cleared. Show "(연결 안 함)" but do NOT clear
    // currentScheduleId: opening and closing the modal must not silently drop
    // a link the user never touched.
    const inList = groups.some((g) => g.items.some((it) => it.id === currentScheduleId));
    sel.value = inList ? currentScheduleId : '';

    sel.addEventListener('change', () => {
      currentScheduleId = sel.value || null;
      // Choosing "(연결 안 함)" unlinks but does not undo the fields the
      // previous pick filled in -- silently wiping values the user can see is
      // not what unlinking means.
      if (!sel.value) return;
      const picked = schedules.find((s) => s.id === sel.value);
      if (!picked) return;

      included.clear();
      (picked.participants || []).forEach((id) => {
        // Ignore participants who are no longer members of the trip.
        if (members.some((m) => m.id === id)) included.add(id);
      });
      renderMembers();
      if (pickHandler) pickHandler({ category: picked.category, date: picked.date });
    });
  }

  return {
    getScheduleId: () => currentScheduleId,
    getExcludedMembers: () => excludedFrom(members, [...included]),
    onSchedulePick: (cb) => { pickHandler = cb; },
  };
}

export { excludedFrom, groupSchedulesForPicker, mountExpenseSplit };
