import { callFunction } from '../api.js';
import { escapeHtml } from '../ui.js';

const STATUS_BADGE = {
  setup: '<span class="badge badge-pending">설정중</span>',
  active: '<span class="badge">진행 중</span>',
  completed: '<span class="badge badge-locked">완료됨</span>',
};

async function mount(root) {
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <p class="label">TripSplit</p>
      <h1>여행 목록</h1>
      <div id="trip-index-list" style="margin-top:1.5rem"><p class="muted">불러오는 중...</p></div>
    </div>`;
  await loadTrips(root);
}

async function loadTrips(root) {
  const listEl = root.querySelector('#trip-index-list');
  let trips;
  try {
    trips = await callFunction('listPublicTrips', {});
  } catch (err) {
    listEl.innerHTML = `<p class="muted">여행 목록을 불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="trip-index-retry">다시 시도</button>`;
    listEl.querySelector('#trip-index-retry').addEventListener('click', () => loadTrips(root));
    return;
  }

  if (trips.length === 0) {
    listEl.innerHTML = '<p class="muted">아직 생성된 여행이 없습니다.</p>';
    return;
  }

  listEl.innerHTML = trips.map((t) => `
    <a href="/t/${encodeURIComponent(t.slug)}" class="card" style="display:block;margin-bottom:0.8rem;text-decoration:none;color:inherit">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
        <strong>${escapeHtml(t.name)}</strong>
        ${STATUS_BADGE[t.status] || ''}
      </div>
      <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(t.period?.start || '')} — ${escapeHtml(t.period?.end || '')} · ${escapeHtml(t.location || '')}</p>
      <span class="tag" style="margin-top:0.5rem;display:inline-block">${escapeHtml(t.group)}</span>
    </a>`).join('');
}

export { mount };
