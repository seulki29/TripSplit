import { escapeHtml } from '../ui.js';

// The backend stores who is EXCLUDED from an expense; the UI shows who is
// SHARING it, because that is how people think about splitting a bill. The
// inversion happens here, once, at the boundary.
//
// Order follows `members` rather than click order so the same selection always
// serialises to the same array -- otherwise two identical splits produce
// different documents and diffs become meaningless.
function excludedFrom(members, includedIds) {
  const included = new Set(includedIds);
  return members.filter((m) => !included.has(m.id)).map((m) => m.id);
}

/**
 * Renders the share-list into `container` and returns the accessor the host
 * modal reads at submit time.
 *
 * Every expense modal shares this so the four of them cannot drift apart on
 * what "who is splitting this" looks like or how it is serialised.
 */
function mountExpenseSplit(container, { members, excludedMembers = [] }) {
  const excluded = new Set(excludedMembers);
  const included = new Set(members.filter((m) => !excluded.has(m.id)).map((m) => m.id));

  container.innerHTML = `
    <div class="field"><label class="label">분담 인원</label><div id="xs-members"></div></div>`;

  function renderMembers() {
    const all = members.length > 0 && members.every((m) => included.has(m.id));
    container.querySelector('#xs-members').innerHTML = `
      <label class="check-inline"><input type="checkbox" id="xs-all" ${all ? 'checked' : ''}> <strong>전체</strong></label>
      ${members.map((m) => `
        <label class="check-inline">
          <input type="checkbox" class="xs-m" data-id="${escapeHtml(m.id)}" ${included.has(m.id) ? 'checked' : ''}>
          ${escapeHtml(m.name)}
        </label>`).join('')}`;

    container.querySelector('#xs-all').addEventListener('change', (ev) => {
      included.clear();
      if (ev.target.checked) members.forEach((m) => included.add(m.id));
      renderMembers();
    });
    container.querySelectorAll('.xs-m').forEach((box) => {
      box.addEventListener('change', () => {
        if (box.checked) included.add(box.dataset.id);
        else included.delete(box.dataset.id);
        renderMembers();
      });
    });
  }
  renderMembers();

  return { getExcludedMembers: () => excludedFrom(members, [...included]) };
}

export { excludedFrom, mountExpenseSplit };
