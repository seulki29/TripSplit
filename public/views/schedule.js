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
// member.js's renderToken.
let renderToken = 0;
let activeDate = null;

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
      renderScheduleInto(body, slug);
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

  const grouped = groupByDate(data.schedules, trip.period);
  if (!activeDate || !grouped.dates.includes(activeDate)) {
    activeDate = grouped.dates[0] || null;
  }

  const view = currentView();
  const ctx = { view, activeDate, members };
  const target = body.querySelector('#sched-body');
  target.innerHTML = view === 'list' ? renderList(grouped, ctx) : renderTimetable(grouped, ctx);

  function reload() {
    renderScheduleInto(body, slug);
  }

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
      onSaved: reload,
    });
  });

  target.querySelectorAll('[data-schedule-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const found = data.schedules.find((s) => s.id === el.dataset.scheduleId);
      if (!found) { showToast('일정을 찾을 수 없습니다.', 'error'); return; }
      openScheduleForm({
        tripId: session.tripId, members, schedule: found, defaultDate: null, onSaved: reload,
      });
    });
  });

  target.querySelectorAll('.tt-daytab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeDate = tab.dataset.date;
      renderScheduleInto(body, slug);
    });
  });
}

export { renderScheduleInto };
