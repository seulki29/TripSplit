import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Same bootstrap as ui.test.js: expenseSplit.js touches the DOM directly, so a
// window has to exist before the module is imported.
const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { mountExpenseSplit } = await import('../views/expenseSplit.js');

const members = [
  { id: 'm1', name: '가온' },
  { id: 'm2', name: '나린' },
  { id: 'm3', name: '다솜' },
];

function sched(over = {}) {
  return {
    id: 's1',
    title: '성산일출봉',
    category: '놀이',
    date: '2026-08-11',
    startMin: 660,
    participants: ['m1', 'm2'],
    ...over,
  };
}

let host;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host');
});

const checkedIds = () => [...host.querySelectorAll('.xs-m')]
  .filter((b) => b.checked)
  .map((b) => b.dataset.id);

// Selecting an <option> programmatically does not fire `change`, which is what
// keeps the initial `sel.value = ...` from wiping the share-list. The user's
// pick has to be simulated.
function pick(value) {
  const sel = host.querySelector('#xs-schedule');
  sel.value = value;
  sel.dispatchEvent(new dom.window.Event('change'));
}

describe('mountExpenseSplit', () => {
  describe('the share-list', () => {
    test('every member is checked when nothing is excluded', () => {
      mountExpenseSplit(host, { members, schedules: [] });
      assert.deepEqual(checkedIds(), ['m1', 'm2', 'm3']);
      assert.equal(host.querySelector('#xs-all').checked, true);
    });

    test('seeds from excludedMembers, showing the complement', () => {
      mountExpenseSplit(host, { members, schedules: [], excludedMembers: ['m2'] });
      assert.deepEqual(checkedIds(), ['m1', 'm3']);
      assert.equal(host.querySelector('#xs-all').checked, false);
    });

    // The screen is include-based, the stored document is exclude-based. An
    // untouched edit modal must round-trip to the identical array or every
    // save would rewrite the field.
    test('an untouched widget returns the excludedMembers it was given', () => {
      const split = mountExpenseSplit(host, {
        members, schedules: [], excludedMembers: ['m2'],
      });
      assert.deepEqual(split.getExcludedMembers(), ['m2']);
    });

    test('unchecking a member adds them to the exclusions', () => {
      const split = mountExpenseSplit(host, { members, schedules: [] });
      host.querySelector('.xs-m[data-id="m3"]').click();
      assert.deepEqual(split.getExcludedMembers(), ['m3']);
    });

    // Order follows `members`, not click order -- otherwise the same choice
    // serialises differently every time.
    test('exclusion order follows the member list, not the click order', () => {
      const split = mountExpenseSplit(host, { members, schedules: [] });
      host.querySelector('.xs-m[data-id="m3"]').click();
      host.querySelector('.xs-m[data-id="m1"]').click();
      assert.deepEqual(split.getExcludedMembers(), ['m1', 'm3']);
    });

    test('전체 unchecks everyone, then rechecks everyone', () => {
      const split = mountExpenseSplit(host, { members, schedules: [] });
      host.querySelector('#xs-all').click();
      assert.deepEqual(split.getExcludedMembers(), ['m1', 'm2', 'm3']);
      host.querySelector('#xs-all').click();
      assert.deepEqual(split.getExcludedMembers(), []);
    });

    test('전체 rechecks itself once the last member is checked back on', () => {
      mountExpenseSplit(host, { members, schedules: [], excludedMembers: ['m2'] });
      assert.equal(host.querySelector('#xs-all').checked, false);
      host.querySelector('.xs-m[data-id="m2"]').click();
      assert.equal(host.querySelector('#xs-all').checked, true);
    });

    // Each toggle rebuilds the subtree, so a listener bound to a destroyed node
    // must not keep firing -- a stacked handler would double-toggle.
    test('repeated toggling stays consistent across rerenders', () => {
      const split = mountExpenseSplit(host, { members, schedules: [] });
      for (let i = 0; i < 5; i += 1) host.querySelector('.xs-m[data-id="m2"]').click();
      assert.deepEqual(split.getExcludedMembers(), ['m2']);
    });
  });

  describe('the schedule picker', () => {
    test('is omitted entirely when no schedule has a date', () => {
      mountExpenseSplit(host, { members, schedules: [sched({ date: null })] });
      assert.equal(host.querySelector('#xs-schedule'), null);
      assert.ok(host.querySelector('#xs-members'), 'the share-list still renders');
    });

    test('groups options by date', () => {
      mountExpenseSplit(host, {
        members,
        schedules: [sched({ id: 'a', date: '2026-08-12' }), sched({ id: 'b', date: '2026-08-11' })],
      });
      const groups = [...host.querySelectorAll('optgroup')];
      assert.deepEqual(groups.map((g) => g.label), ['8.11', '8.12']);
    });

    test('picking a schedule replaces the share-list with its participants', () => {
      const split = mountExpenseSplit(host, { members, schedules: [sched()] });
      pick('s1');
      assert.deepEqual(checkedIds(), ['m1', 'm2']);
      assert.deepEqual(split.getExcludedMembers(), ['m3']);
      assert.equal(split.getScheduleId(), 's1');
    });

    // A participant list can outlive the member it names. Note this passes even
    // with the widget's `members.some(...)` guard removed: a ghost id sitting in
    // the included set matches no member, so `excludedFrom` filters it out
    // anyway. What is pinned here is the end-to-end property -- a stale
    // participant does not disturb the split -- not the guard itself, which is
    // belt-and-braces over that.
    test('a participant who is no longer a member is dropped', () => {
      const split = mountExpenseSplit(host, {
        members, schedules: [sched({ participants: ['m1', 'ghost'] })],
      });
      pick('s1');
      assert.deepEqual(checkedIds(), ['m1']);
      assert.deepEqual(split.getExcludedMembers(), ['m2', 'm3']);
    });

    test('reports the picked category and date to the host modal', () => {
      const split = mountExpenseSplit(host, { members, schedules: [sched()] });
      const seen = [];
      split.onSchedulePick((info) => seen.push(info));
      pick('s1');
      assert.deepEqual(seen, [{ category: '놀이', date: '2026-08-11' }]);
    });

    // Unlinking must not undo fields an earlier pick filled in, so the callback
    // stays silent for the empty option.
    test('(연결 안 함) unlinks without firing the pick callback', () => {
      const split = mountExpenseSplit(host, {
        members, schedules: [sched()], scheduleId: 's1',
      });
      const seen = [];
      split.onSchedulePick((info) => seen.push(info));
      pick('');
      assert.equal(split.getScheduleId(), null);
      assert.deepEqual(seen, []);
    });

    test('(연결 안 함) leaves the share-list alone', () => {
      const split = mountExpenseSplit(host, {
        members, schedules: [sched()], scheduleId: 's1', excludedMembers: ['m3'],
      });
      pick('');
      assert.deepEqual(split.getExcludedMembers(), ['m3']);
    });

    test('preselects a stored scheduleId that is in the list', () => {
      mountExpenseSplit(host, { members, schedules: [sched()], scheduleId: 's1' });
      assert.equal(host.querySelector('#xs-schedule').value, 's1');
    });

    // The schedule was deleted, or its date was cleared. Showing (연결 안 함)
    // while keeping the id is deliberate: opening and closing a modal must not
    // silently drop a link the user never touched.
    test('a stored scheduleId missing from the list shows unlinked but is kept', () => {
      const split = mountExpenseSplit(host, {
        members, schedules: [sched()], scheduleId: 'deleted',
      });
      assert.equal(host.querySelector('#xs-schedule').value, '');
      assert.equal(split.getScheduleId(), 'deleted');
    });

    test('mounting with a stored scheduleId does not reset the share-list', () => {
      const split = mountExpenseSplit(host, {
        members, schedules: [sched()], scheduleId: 's1', excludedMembers: ['m1'],
      });
      assert.deepEqual(split.getExcludedMembers(), ['m1']);
    });
  });
});
