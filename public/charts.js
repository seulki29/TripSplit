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

// Per-day figures keep up to two decimals here. The table rounds them to won;
// repeating that rounding inside the modal would break the chain -- hand-adding
// the rounded values is exactly the 1-won discrepancy this modal explains.
function perDay(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function detailRow(label, value, isFocus) {
  return `
    <div class="cmp-detail-row${isFocus ? ' cmp-focus' : ''}">
      <span class="label">${label}</span>
      <span class="mono cmp-detail-value">${value}</span>
    </div>`;
}

function renderComparisonDetail({
  category, categoryTotal, headcount, tripDays,
  currentPerDay, groupPerDay, tripsInComparison, focus,
}) {
  const name = escapeHtml(category);
  const currentValue = headcount > 0
    ? `${Number(categoryTotal).toLocaleString()}원 ÷ ${headcount}명 ÷ ${tripDays}일 = ${perDay(currentPerDay)}원/일`
    : `${perDay(currentPerDay)}원/일`;

  const hasGroup = typeof groupPerDay === 'number' && groupPerDay > 0;
  const header = `<div style="font-size:12px;color:#666;margin-bottom:0.6rem">${name}</div>`;
  if (!hasGroup) {
    return `
      ${header}
      ${detailRow('이번', currentValue, focus === 'current')}
      ${detailRow('그룹평균', '—', focus === 'group')}
      <p class="muted" style="margin-top:0.8rem;font-size:13px">과거 완료 여행에 '${name}' 지출이 없어 비교 기준이 없습니다.</p>`;
  }

  const diff = currentPerDay - groupPerDay;
  const pct = Math.round((diff / groupPerDay) * 100);
  const delta = Math.round(diff * tripDays);
  const sign = pct >= 0 ? '+' : '';
  const tone = pct >= 0 ? 'pay' : 'receive';

  return `
    ${header}
    ${detailRow('이번', currentValue, focus === 'current')}
    ${detailRow('그룹평균', `${perDay(groupPerDay)}원/일`, focus === 'group')}
    <p class="muted" style="margin:0 0 0.2rem 0.5rem;font-size:12px">과거 완료 여행 ${tripsInComparison}개의 하루 비율 평균</p>
    <div class="cmp-detail-rule"></div>
    ${detailRow('차이', `${perDay(diff)}원/일`, false)}
    ${detailRow('편차', `${perDay(diff)} ÷ ${perDay(groupPerDay)} = <strong style="color:var(--${tone})">${sign}${pct}%</strong>`, focus === 'cmp')}
    ${detailRow('여행 전체', `${perDay(diff)} × ${tripDays}일 = <strong style="color:var(--${tone})">${sign}${delta.toLocaleString()}원</strong>`, focus === 'delta')}
    <p style="margin-top:0.8rem;font-size:13px">평소 페이스대로였다면 ${tripDays}일간 1인당 ${Math.round(groupPerDay * tripDays).toLocaleString()}원. 이번엔 ${Math.round(currentPerDay * tripDays).toLocaleString()}원 들었습니다.</p>
    <p class="muted" style="margin-top:0.5rem;font-size:12px">표의 숫자는 원 단위로 반올림해 표시합니다.</p>`;
}

export { renderDonutChart, renderCategoryComparison, renderComparisonDetail };
