import { escapeHtml } from '../ui.js';
import { categoryTag } from '../categories.js';
import { minToLabel } from '../scheduleLayout.js';
import { dayLabel, participantLabel } from './scheduleTimetable.js';

function renderRow(entry, members) {
  const time = entry.startMin === null
    ? '<span class="muted">시간 미정</span>'
    : `${minToLabel(entry.startMin)}–${minToLabel(entry.endMin)}`;

  return `<button type="button" class="sl-row" data-schedule-id="${escapeHtml(entry.id)}">
    <span class="sl-time">${time}</span>
    <span class="sl-main">
      ${categoryTag(entry.category)}
      <strong>${escapeHtml(entry.title)}</strong>
      ${entry.placeName ? `<span class="muted sl-place">📍 ${escapeHtml(entry.placeName)}</span>` : ''}
    </span>
    <span class="muted sl-people">👥 ${escapeHtml(participantLabel(entry, members))}</span>
  </button>`;
}

function renderList(grouped, ctx) {
  const { dates, byDate, floating } = grouped;
  const { members } = ctx;

  if (dates.length === 0 && floating.length === 0) {
    return '<p class="muted">아직 등록된 일정이 없습니다.</p>';
  }

  const sections = [];

  if (floating.length > 0) {
    sections.push(`<div class="sl-group">
      <div class="sl-group-head">미정</div>
      ${floating.map((e) => renderRow(e, members)).join('')}
    </div>`);
  }

  for (const d of dates) {
    const rows = [...byDate[d].timed, ...byDate[d].untimed];
    if (rows.length === 0) continue;
    sections.push(`<div class="sl-group">
      <div class="sl-group-head">${escapeHtml(dayLabel(d))}</div>
      ${rows.map((e) => renderRow(e, members)).join('')}
    </div>`);
  }

  if (sections.length === 0) return '<p class="muted">아직 등록된 일정이 없습니다.</p>';
  return sections.join('');
}

export { renderList };
