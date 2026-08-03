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
// connector between rows is a plain vertical line.
const PER_ROW = 3;
const CELL_W = 100;
const ROW_H = 90;
const NODE_R = 14;
const CANVAS_W = 300;

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

export {
  buildWaypoints, serpentineLayout,
  PER_ROW, CELL_W, ROW_H, NODE_R, CANVAS_W,
};
