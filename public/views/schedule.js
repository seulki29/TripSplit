import { callFunction } from '../api.js';
import { getSession } from '../session.js';
import { escapeHtml, showToast } from '../ui.js';
import { groupByDate } from '../scheduleLayout.js';
import { renderTimetable } from './scheduleTimetable.js';
import { renderList } from './scheduleList.js';
import { openScheduleForm } from './scheduleForm.js';

const VIEW_KEY = 'tripsplit.scheduleView';
const VIEWS = [
  ['week', '주간'], ['day', '하루'], ['flow', '연속'], ['list', '목록'],
];

// Prevents a slow earlier load's response from landing after a newer one and
// overwriting fresher data when the tab is re-rendered. Same idiom as
// member.js's renderToken. A repaint from cache (see paintSchedule) does no
// await, so it never needs this guard.
let renderToken = 0;
let activeDate = null;

// Cache of the last successful fetch, so a pure client-side action (view
// switch, day-tab switch) can repaint without a network round trip. Safe to
// keep as module scope across trips: the app does a hard `location.href`
// navigation whenever the active trip changes, which reloads this module
// (and resets the cache) along with everything else.
let cache = null; // { schedules, members, period } | null

function currentView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some(([v]) => v === saved)) return saved;
  } catch {
    // localStorage is blocked in this browser (e.g. Safari private mode) — fall back to the default
  }
  return 'week';
}

function setView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A failed save should not block the feature
  }
}


// Entry point. Always refetches: called on first entry into the tab, and
// member.js / admin.js call it again on every tab switch, so it must reflect
// the current server state rather than whatever happens to be cached.
async function renderScheduleInto(body, slug) {
  const myToken = ++renderToken;
  const session = getSession();

  body.innerHTML = `
    <div class="sched-bar">
      <div class="sched-seg" id="sched-views">
        ${VIEWS.map(([v, label]) => `<button type="button" data-view="${v}"
          class="${v === currentView() ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-secondary" id="sched-refresh">새로고침</button>
      <button type="button" class="btn btn-primary" id="sched-add" disabled>일정 추가</button>
    </div>
    <div id="sched-body"><p class="muted">불러오는 중...</p></div>`;

  body.querySelectorAll('#sched-views button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      // A view-arrangement toggle is purely client-side — repaint from the
      // cached data instead of re-issuing the three callables.
      paintSchedule(body, slug);
    });
  });
  body.querySelector('#sched-refresh').addEventListener('click', () => {
    renderScheduleInto(body, slug);
  });

  let data, members, trip;
  try {
    [data, members, trip] = await Promise.all([
      callFunction('listSchedules', { tripId: session.tripId }),
      callFunction('listMembers', { tripId: session.tripId }),
      callFunction('getTripSetup', { tripId: session.tripId }),
    ]);
  } catch (err) {
    if (myToken !== renderToken) return;
    // Drop the stale cache so a view-switcher or day-tab click hitting
    // paintSchedule while the error banner is showing can't silently repaint
    // the old pre-refresh data over it. paintSchedule's null-cache fallback
    // turns that click into a real refetch instead -- the same thing a
    // click would have done before fetch and repaint were split apart.
    cache = null;
    // Without the member list we can't render the participant checklist. Rather
    // than leave a button that does nothing when clicked, disable it.
    body.querySelector('#sched-add').disabled = true;
    const target = body.querySelector('#sched-body');
    target.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p>
      <button type="button" class="btn btn-secondary" id="sched-retry">다시 시도</button>`;
    target.querySelector('#sched-retry').addEventListener('click', () => renderScheduleInto(body, slug));
    return;
  }
  if (myToken !== renderToken) return;

  cache = { schedules: data.schedules, members, period: trip.period };

  const addBtn = body.querySelector('#sched-add');
  // Data has loaded and the handler below is now bound, so the button can
  // safely leave the disabled state it was rendered with during the load window.
  addBtn.disabled = false;
  addBtn.addEventListener('click', () => {
    openScheduleForm({
      tripId: session.tripId,
      members,
      schedule: null,
      defaultDate: activeDate || trip.period?.start || '',
      onSaved: () => renderScheduleInto(body, slug),
    });
  });

  paintSchedule(body, slug);
}

// Repaints #sched-body (and the view-switcher's active state) from the
// cached payload. No network call, so no loading flash — this is what keeps
// paging through days or switching arrangements instant.
function paintSchedule(body, slug) {
  // A repaint should never run against a null cache. This can only happen if
  // it's somehow reached before any successful load (e.g. a stray click
  // racing the very first fetch) — fall back to a real fetch instead of
  // throwing on cache.schedules below.
  if (!cache) {
    renderScheduleInto(body, slug);
    return;
  }

  const { schedules, members, period } = cache;
  const session = getSession();

  const grouped = groupByDate(schedules, period);
  if (!activeDate || !grouped.dates.includes(activeDate)) {
    activeDate = grouped.dates[0] || null;
  }

  const view = currentView();
  body.querySelectorAll('#sched-views button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const ctx = { view, activeDate, members };
  const target = body.querySelector('#sched-body');
  target.innerHTML = view === 'list' ? renderList(grouped, ctx) : renderTimetable(grouped, ctx);

  target.querySelectorAll('[data-schedule-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const found = schedules.find((s) => s.id === el.dataset.scheduleId);
      if (!found) { showToast('일정을 찾을 수 없습니다.', 'error'); return; }
      openScheduleForm({
        tripId: session.tripId,
        members,
        schedule: found,
        defaultDate: null,
        onSaved: () => renderScheduleInto(body, slug),
      });
    });
  });

  target.querySelectorAll('.tt-daytab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeDate = tab.dataset.date;
      // Switching the active day is also purely client-side.
      paintSchedule(body, slug);
    });
  });
}

export { renderScheduleInto };
