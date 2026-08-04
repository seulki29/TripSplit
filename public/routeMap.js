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
const PER_ROW = 4;
const CELL_W = 80;
const ROW_H = 90;
const CANVAS_W = 320;

// Distance from the canvas top to the first row's anchor. It is NOT ROW_H/2:
// the tallest thing above an anchor is the date chip, whose baseline sits at
// cy-42, and SVG text grows upward from its baseline (~7 units of ascender at
// font-size 9). At cy=45 that glyph would start at y=-4 and be clipped away.
const TOP_PAD = 52;

// Marker geometry. The pin is a map teardrop whose TIP sits on the anchor
// point, with the balloon rising above it -- so the route line, which runs
// through the anchors, reads as one continuous path with pins stuck into it
// rather than as separate segments strung between markers.
const PIN_R = 11;   // balloon radius
const PIN_H = 26;   // anchor (tip) to balloon centre

// How far the row-change connector bulges away from the canvas centre. 30 keeps
// the curve 6.3 units clear of the next row's balloon while peaking at x=302.5
// inside the 320-wide canvas.
const ROW_BULGE = 30;

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
      cy: TOP_PAD + row * ROW_H,
    };
  });

  const rows = Math.ceil(waypoints.length / PER_ROW);
  // Height runs from the last row's anchor down past its second label line
  // (cy+24, plus descender and a little air), not a whole extra row -- a
  // one-row map should not carry 90 units of dead space beneath it.
  return { nodes, width: CANVAS_W, height: (rows - 1) * ROW_H + TOP_PAD + 30 };
}

// Cells are 80 units wide, so labels wrap tighter than they did at 3 per row.
const LABEL_LINE = 6;
const LABEL_MAX = 12;

// SVG has no automatic text wrapping, so long place names are split by hand
// into at most two lines. The full name goes in a <title> for desktop hover;
// touch users see only the truncated form, which is accepted -- the untruncated
// name is one tap away in the schedule tab.
function labelLines(label) {
  if (label.length <= LABEL_LINE) return [label];
  if (label.length <= LABEL_MAX) return [label.slice(0, LABEL_LINE), label.slice(LABEL_LINE)];
  return [label.slice(0, LABEL_LINE), `${label.slice(LABEL_LINE, LABEL_MAX - 1)}…`];
}

/**
 * The whole route as ONE continuous path through every anchor point, drawn
 * before the markers so the pins sit on top of it.
 *
 * Why one path and not a segment per pair: segments that start and stop at each
 * marker's edge read as "a line between this pin and that one". A single
 * unbroken stroke running underneath reads as one road with pins stuck into it,
 * which is what a route map should look like.
 *
 * Within a row the run is straight. A row change keeps the same column slot, so
 * both ends share cx and a straight drop would spear the next row's balloon --
 * the curve bulges away from the canvas centre to pass outside it.
 */
function renderRoutePath(nodes) {
  if (nodes.length < 2) return '';

  const d = [`M${nodes[0].cx} ${nodes[0].cy}`];
  for (let i = 1; i < nodes.length; i += 1) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (a.cy === b.cy) {
      d.push(`L${b.cx} ${b.cy}`);
    } else {
      const bx = a.cx + (a.cx > CANVAS_W / 2 ? ROW_BULGE : -ROW_BULGE);
      d.push(`C${bx} ${a.cy}, ${bx} ${b.cy}, ${b.cx} ${b.cy}`);
    }
  }
  return `<path class="rm-link" d="${d.join(' ')}" fill="none"></path>`;
}

// A map pin: tip at the anchor, balloon centred PIN_H above it. The two cubics
// taper the balloon's sides down into the point.
function pinPath(cx, cy) {
  const by = cy - PIN_H;
  return [
    `M${cx} ${cy}`,
    `C${cx - PIN_R * 0.55} ${cy - PIN_H * 0.45}, ${cx - PIN_R} ${by + PIN_R * 0.6}, ${cx - PIN_R} ${by}`,
    `A${PIN_R} ${PIN_R} 0 0 1 ${cx + PIN_R} ${by}`,
    `C${cx + PIN_R} ${by + PIN_R * 0.6}, ${cx + PIN_R * 0.55} ${cy - PIN_H * 0.45}, ${cx} ${cy}`,
    'Z',
  ].join(' ');
}

// The pin's fill (--paper) is set in CSS on .rm-node, not as a `fill="..."`
// attribute here: `var()` is not a valid paint value in SVG's presentation
// attribute grammar, so an attribute would be dropped and fall back to the
// SVG initial fill (black), hiding the numeral inside it.
//
// Labels sit below the anchor and the date chip above the balloon, so neither
// collides with the route line running through the anchor.
function renderNode(node, showDate) {
  const { waypoint: w, cx, cy, index } = node;
  const lines = labelLines(w.label);
  const label = lines.map((line, i) => (
    `<tspan x="${cx}" dy="${i === 0 ? 0 : 11}">${escapeHtml(line)}</tspan>`
  )).join('');

  return `<g>
    <title>${escapeHtml(w.label)}</title>
    ${showDate ? `<text class="rm-date" x="${cx}" y="${cy - PIN_H - PIN_R - 5}">${escapeHtml(formatDate(w.date))}</text>` : ''}
    <path class="rm-node" d="${pinPath(cx, cy)}" stroke="${categoryMark(w.category)}"></path>
    <text class="rm-num" x="${cx}" y="${cy - PIN_H + 4}">${index + 1}</text>
    <text class="rm-label" y="${cy + 13}">${label}</text>
  </g>`;
}

function renderRouteMap(waypoints, { location, period } = {}) {
  if (waypoints.length === 0) {
    return `<p class="muted">아직 경로에 표시할 장소가 없습니다.<br>
      일정에 위치를 적거나, 경비 목록에서 경유지로 표시해보세요.</p>`;
  }

  const { nodes, width, height } = serpentineLayout(waypoints);

  const links = renderRoutePath(nodes);
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
