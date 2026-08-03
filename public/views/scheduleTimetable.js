import { escapeHtml } from '../ui.js';
import { categorySlug } from '../categories.js';
import { assignLanes, timeRangeFor, minToLabel, PX_PER_MIN } from '../scheduleLayout.js';

const HOUR_PX = 60 * PX_PER_MIN;

function participantLabel(entry, members) {
  // Stored participants may still contain IDs of members who were later
  // removed. Don't touch the data -- just filter them out at display time.
  const alive = (entry.participants || []).filter((id) => members.some((m) => m.id === id));
  if (members.length > 0 && alive.length === members.length) return '전원';
  return `${alive.length}명`;
}

/**
 * A single block. How many lines it holds depends on its height -- cramming
 * three lines into a 30-minute block would just get everything clipped.
 */
function renderBlock(entry, lane, laneCount, fromMin, members) {
  const top = (entry.startMin - fromMin) * PX_PER_MIN;
  const height = (entry.endMin - entry.startMin) * PX_PER_MIN;
  const width = 100 / laneCount;
  const left = lane * width;
  const mins = entry.endMin - entry.startMin;

  const lines = [`<span class="tt-title">${escapeHtml(entry.title)}</span>`];
  if (mins > 30 && entry.placeName) {
    lines.push(`<span class="tt-place">📍 ${escapeHtml(entry.placeName)}</span>`);
  }
  if (mins > 60) {
    lines.push(`<span class="tt-people">👥 ${escapeHtml(participantLabel(entry, members))}</span>`);
  }

  return `<button type="button" class="tt-block" data-schedule-id="${escapeHtml(entry.id)}"
    data-cat="${categorySlug(entry.category)}"
    style="top:${top}px;height:${height}px;left:${left}%;width:calc(${width}% - 2px)">
    ${lines.join('')}
  </button>`;
}

function renderUntimedStrip(entries) {
  if (entries.length === 0) return '<div class="tt-untimed"></div>';
  return `<div class="tt-untimed">${entries.map((e) => `
    <button type="button" class="tt-chip" data-schedule-id="${escapeHtml(e.id)}"
      data-cat="${categorySlug(e.category)}">${escapeHtml(e.title)}</button>`).join('')}</div>`;
}

/** One day's time-axis column. All three views share this single function. */
function renderDayColumn(bucket, fromMin, toMin, members) {
  const height = (toMin - fromMin) * PX_PER_MIN;
  const placed = assignLanes(bucket.timed);
  return `<div class="tt-col" style="height:${height}px">
    ${placed.map((p) => renderBlock(p.entry, p.lane, p.laneCount, fromMin, members)).join('')}
  </div>`;
}

function renderGutter(fromMin, toMin) {
  const rows = [];
  for (let m = fromMin; m <= toMin; m += 60) {
    rows.push(`<div class="tt-hour" style="height:${HOUR_PX}px">${minToLabel(m)}</div>`);
  }
  return `<div class="tt-gutter">${rows.join('')}</div>`;
}

function dayLabel(date) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(`${date}T00:00:00Z`);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${md} (${days[d.getUTCDay()]})`;
}

function renderFloating(floating) {
  if (floating.length === 0) return '';
  return `<div class="tt-floating">
    <span class="label">미정</span>
    ${floating.map((e) => `<button type="button" class="tt-chip" data-schedule-id="${escapeHtml(e.id)}"
      data-cat="${categorySlug(e.category)}">${escapeHtml(e.title)}</button>`).join('')}
  </div>`;
}

function renderTimetable(grouped, ctx) {
  const { dates, byDate, floating } = grouped;
  const { view, activeDate, members } = ctx;

  if (dates.length === 0 && floating.length === 0) {
    return '<p class="muted">아직 등록된 일정이 없습니다.</p>';
  }

  const all = dates.flatMap((d) => byDate[d].timed);
  const { fromMin, toMin } = timeRangeFor(all);

  if (view === 'week') {
    return `${renderFloating(floating)}
      <div class="tt-week">
        <div class="tt-week-head"><div class="tt-gutter-head"></div>
          ${dates.map((d) => `<div class="tt-day-head">${escapeHtml(dayLabel(d))}</div>`).join('')}
        </div>
        <div class="tt-week-untimed"><div class="tt-gutter-head"></div>
          ${dates.map((d) => renderUntimedStrip(byDate[d].untimed)).join('')}
        </div>
        <div class="tt-week-body">
          ${renderGutter(fromMin, toMin)}
          ${dates.map((d) => renderDayColumn(byDate[d], fromMin, toMin, members)).join('')}
        </div>
      </div>`;
  }

  if (view === 'day') {
    const date = dates.includes(activeDate) ? activeDate : dates[0];
    if (!date) return `${renderFloating(floating)}<p class="muted">날짜가 있는 일정이 없습니다.</p>`;
    return `${renderFloating(floating)}
      <div class="tt-daytabs">
        ${dates.map((d) => `<button type="button" class="tt-daytab${d === date ? ' active' : ''}"
          data-date="${escapeHtml(d)}">${escapeHtml(dayLabel(d))}</button>`).join('')}
      </div>
      ${renderUntimedStrip(byDate[date].untimed)}
      <div class="tt-single">
        ${renderGutter(fromMin, toMin)}
        ${renderDayColumn(byDate[date], fromMin, toMin, members)}
      </div>`;
  }

  // view === 'flow'
  return `${renderFloating(floating)}
    ${dates.map((d) => `
      <div class="tt-flow-day">
        <div class="tt-flow-head">${escapeHtml(dayLabel(d))}</div>
        ${renderUntimedStrip(byDate[d].untimed)}
        <div class="tt-single">
          ${renderGutter(fromMin, toMin)}
          ${renderDayColumn(byDate[d], fromMin, toMin, members)}
        </div>
      </div>`).join('')}`;
}

export { renderTimetable, dayLabel, participantLabel };
