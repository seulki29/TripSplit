import { escapeHtml } from './ui.js';
import { categoryMark } from './categories.js';
import { formatDate } from './format.js';

// The route map is a retrospective diagram, not a navigational one: node
// positions encode visit order only. The app stores no coordinates.

// Plan 11 lets a user paste a map URL into a schedule's place field. Those
// make useless node labels, so they are dropped rather than rendered.
const URL_RE = /^https?:\/\//i;

// Expenses carry a date but no time, so they sort to the end of their day.
// Schedule entries with no time land here too, and stay ahead of expenses
// because they are pushed first and Array#sort is stable.
const END_OF_DAY = 1440;

function buildWaypoints(schedules, expenses) {
  const items = [];

  for (const s of schedules) {
    if (!s.date) continue;
    const label = String(s.placeName ?? '').trim();
    if (!label || URL_RE.test(label)) continue;
    items.push({
      label, category: s.category, date: s.date,
      sortMin: typeof s.startMin === 'number' ? s.startMin : END_OF_DAY,
    });
  }

  for (const e of expenses) {
    if (e.isWaypoint !== true || !e.date) continue;
    const label = String(e.merchant ?? '').trim();
    if (!label) continue;
    items.push({ label, category: e.category, date: e.date, sortMin: END_OF_DAY });
  }

  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.sortMin - b.sortMin;
  });

  // Collapse a run of stops at the same place on the same day into one node.
  // The date is part of the comparison on purpose: returning to the airport on
  // the last day must show as a second node, or the journey looks one-way.
  const out = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && prev.label === item.label && prev.date === item.date) continue;
    out.push({ label: item.label, category: item.category, date: item.date });
  }
  return out;
}

// Layout is a boustrophedon: rows alternate direction, so consecutive nodes
// are always adjacent. Because a row change keeps the same column slot, the
// connector between rows runs vertically, curving out to clear the row's
// label and date chip (see renderLink).
const PER_ROW = 3;
const CELL_W = 100;
const ROW_H = 90;
const NODE_R = 14;
const CANVAS_W = 300;

// How far the row-change connector bulges away from the canvas centre. See the
// why comment on renderLink for what this clears.
const ROW_BULGE = 34;

// Rows per row count is fixed rather than responsive: the SVG is drawn in a
// viewBox and stretched with width:100%, so cells shrink on a phone and grow
// on a desktop without this function ever knowing the viewport.
function serpentineLayout(waypoints) {
  const nodes = waypoints.map((waypoint, index) => {
    const row = Math.floor(index / PER_ROW);
    const col = index % PER_ROW;
    const slot = row % 2 === 0 ? col : PER_ROW - 1 - col;
    return {
      waypoint,
      index,
      row,
      col,
      cx: CELL_W / 2 + slot * CELL_W,
      cy: ROW_H / 2 + row * ROW_H,
    };
  });

  const rows = Math.ceil(waypoints.length / PER_ROW);
  return { nodes, width: CANVAS_W, height: rows * ROW_H + 20 };
}

const LABEL_LINE = 7;
const LABEL_MAX = 14;

// SVG has no automatic text wrapping, so long place names are split by hand
// into at most two lines. The full name goes in a <title> for desktop hover;
// touch users see only the truncated form, which is accepted -- the untruncated
// name is one tap away in the schedule tab.
function labelLines(label) {
  if (label.length <= LABEL_LINE) return [label];
  if (label.length <= LABEL_MAX) return [label.slice(0, LABEL_LINE), label.slice(LABEL_LINE)];
  return [label.slice(0, LABEL_LINE), `${label.slice(LABEL_LINE, LABEL_MAX - 1)}…`];
}

// A row change keeps the same column slot, so cx is identical either side of
// it. Within a row the connector is a straight horizontal line, stopping at
// the node edge rather than its centre so the line never shows through the
// circle.
function renderLink(a, b) {
  if (a.cy === b.cy) {
    const dir = b.cx > a.cx ? 1 : -1;
    return `<line class="rm-link" x1="${a.cx + NODE_R * dir}" y1="${a.cy}" x2="${b.cx - NODE_R * dir}" y2="${b.cy}"></line>`;
  }
  // Why a curve and not a straight vertical line: a row change keeps the same
  // column slot on both ends, so a straight line runs right through the upper
  // node's label lines and the lower node's date chip, both of which are
  // centred on this same cx. Bulging the connector outward -- away from the
  // canvas centre, toward whichever edge this column is nearer -- routes it
  // around that text instead of through it. Do not "simplify" this back to a
  // <line>.
  const y1 = a.cy + NODE_R;
  const y2 = b.cy - NODE_R;
  const bulge = a.cx > CANVAS_W / 2 ? ROW_BULGE : -ROW_BULGE;
  const cx1 = a.cx + bulge;
  return `<path class="rm-link" d="M${a.cx} ${y1} C ${cx1} ${y1}, ${cx1} ${y2}, ${b.cx} ${y2}" fill="none"></path>`;
}

// The node's fill (--paper) is set in CSS on .rm-node, not as a `fill="..."`
// attribute here: `var()` is not a valid paint value in SVG's presentation
// attribute grammar, so an attribute would be dropped and fall back to the
// SVG initial fill (black), hiding the numeral inside it.
function renderNode(node, showDate) {
  const { waypoint: w, cx, cy, index } = node;
  const lines = labelLines(w.label);
  const label = lines.map((line, i) => (
    `<tspan x="${cx}" dy="${i === 0 ? 0 : 11}">${escapeHtml(line)}</tspan>`
  )).join('');

  return `<g>
    <title>${escapeHtml(w.label)}</title>
    ${showDate ? `<text class="rm-date" x="${cx}" y="${cy - NODE_R - 6}">${escapeHtml(formatDate(w.date))}</text>` : ''}
    <circle class="rm-node" cx="${cx}" cy="${cy}" r="${NODE_R}" stroke="${categoryMark(w.category)}"></circle>
    <text class="rm-num" x="${cx}" y="${cy + 4}">${index + 1}</text>
    <text class="rm-label" y="${cy + NODE_R + 13}">${label}</text>
  </g>`;
}

function renderRouteMap(waypoints, { location, period } = {}) {
  if (waypoints.length === 0) {
    return `<p class="muted">아직 경로에 표시할 장소가 없습니다.<br>
      일정에 위치를 적거나, 경비 목록에서 경유지로 표시해보세요.</p>`;
  }

  const { nodes, width, height } = serpentineLayout(waypoints);

  const links = nodes.slice(1).map((n, i) => renderLink(nodes[i], n)).join('');
  const marks = nodes.map((n, i) => (
    renderNode(n, i === 0 || nodes[i - 1].waypoint.date !== n.waypoint.date)
  )).join('');

  const parts = [];
  if (period?.start && period?.end) parts.push(`${formatDate(period.start)} – ${formatDate(period.end)}`);
  parts.push(`${waypoints.length}곳`);
  if (location) parts.push(location);

  return `<p class="muted rm-caption">${escapeHtml(parts.join(' · '))}</p>
    <svg class="rm-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="여행 경로">
      ${links}${marks}
    </svg>`;
}

export { buildWaypoints, serpentineLayout, renderRouteMap };
