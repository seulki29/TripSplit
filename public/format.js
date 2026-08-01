// Expense dates are always within one trip, so the year is noise. '2026-07-30' -> '7.30'
function formatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  return `${Number(m[2])}.${Number(m[3])}`;
}

export { formatDate };
