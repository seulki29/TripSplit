import { escapeHtml } from './ui.js';
import { categoryMark, categoryDot } from './categories.js';

const RADIUS = 40;
const SEGMENT_GAP = 2; // surface gap between donut segments, in path units

function renderDonutChart(categoryTotals) {
  const entries = Object.entries(categoryTotals).filter(([, amount]) => amount > 0);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (total <= 0) return '<p class="muted">지출 내역이 없습니다.</p>';

  const circumference = 2 * Math.PI * RADIUS;
  let offset = 0;
  const circles = entries.map(([category, amount]) => {
    const dash = (amount / total) * circumference;
    const visible = Math.max(0, dash - SEGMENT_GAP);
    const circle = `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="${categoryMark(category)}" stroke-width="16" stroke-dasharray="${visible} ${circumference - visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"></circle>`;
    offset += dash;
    return circle;
  }).join('');

  const legend = entries.map(([category, amount]) => `
    <div class="cmp-legend-row">${categoryDot(category)}
      <span>${escapeHtml(category)} · ${Math.round(amount).toLocaleString()}원 · ${Math.round((amount / total) * 100)}%</span>
    </div>`).join('');

  return `
    <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem">
      <svg viewBox="0 0 100 100" width="140" height="140">${circles}</svg>
      <div>${legend}</div>
    </div>`;
}

function renderCategoryComparison(currentPerDay, groupPerDay, tripDays) {
  const categories = Object.keys(currentPerDay);
  if (categories.length === 0) return '<p class="muted">비교할 수 있는 카테고리가 없습니다.</p>';

  const rows = categories.map((category) => {
    const current = currentPerDay[category];
    const group = groupPerDay[category];
    // A category the group has never spent on (or averages to 0) has no
    // baseline to divide by -- the row still renders, with `--` in the
    // group/deviation/trip-total cells instead of being dropped.
    const hasGroup = typeof group === 'number' && group > 0;
    return {
      category,
      current: Math.round(current),
      group: hasGroup ? Math.round(group) : null,
      pct: hasGroup ? Math.round(((current - group) / group) * 100) : null,
      delta: hasGroup ? Math.round((current - group) * tripDays) : null,
    };
  }).sort((a, b) => b.current - a.current);

  // Normalised on the largest |percentage| among rows that actually have one --
  // rows without a group baseline show `--` and never contribute a bar.
  const pctMagnitudes = rows.filter((r) => r.pct !== null).map((r) => Math.abs(r.pct));
  const maxAbsPct = pctMagnitudes.length > 0 ? Math.max(...pctMagnitudes, 1) : 0;

  const body = rows.map((r) => {
    const groupCell = r.group === null
      ? '<td class="cmp-num mono cmp-group">—</td>'
      : `<td class="cmp-num mono cmp-group">${r.group.toLocaleString()}</td>`;

    let cmpCell;
    let deltaCell;
    if (r.pct === null) {
      cmpCell = '<td class="cmp-num mono">—</td>';
      deltaCell = '<td class="cmp-num mono">—</td>';
    } else {
      const width = (Math.abs(r.pct) / maxAbsPct) * 50;
      const bar = r.pct === 0 ? '' : `<div class="cmp-bar-fill ${r.pct > 0 ? 'cmp-bar-pos' : 'cmp-bar-neg'}" style="width:${width}%;background:${categoryMark(r.category)}"></div>`;
      const tone = r.pct >= 0 ? 'pay' : 'receive';
      const sign = r.pct >= 0 ? '+' : '';
      cmpCell = `<td><div class="cmp-cell"><div class="cmp-bar">${bar}</div><span class="cmp-pct mono" style="color:var(--${tone})">${sign}${r.pct}%</span></div></td>`;
      deltaCell = `<td class="cmp-num mono" style="color:var(--${tone})">${sign}${r.delta.toLocaleString()}원</td>`;
    }

    return `
      <tr>
        <td class="cmp-cat">${categoryDot(r.category)} ${escapeHtml(r.category)}</td>
        <td class="cmp-num mono">${r.current.toLocaleString()}</td>
        ${groupCell}
        ${cmpCell}
        ${deltaCell}
      </tr>`;
  }).join('');

  return `
    <p class="label" style="margin-bottom:0.4rem">카테고리 비교 · 하루 · 1인 기준</p>
    <div style="overflow-x:auto">
    <table class="cmp-table">
      <thead><tr>
        <th class="cmp-cat">카테고리</th>
        <th class="cmp-num">이번</th>
        <th class="cmp-num cmp-group">그룹평균</th>
        <th>편차</th>
        <th class="cmp-num">여행 전체</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

export { renderDonutChart, renderCategoryComparison };
