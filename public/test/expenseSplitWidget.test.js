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

let host;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host');
});

const checkedIds = () => [...host.querySelectorAll('.xs-m')]
  .filter((b) => b.checked)
  .map((b) => b.dataset.id);

describe('mountExpenseSplit', () => {
  test('every member is checked when nothing is excluded', () => {
    mountExpenseSplit(host, { members });
    assert.deepEqual(checkedIds(), ['m1', 'm2', 'm3']);
    assert.equal(host.querySelector('#xs-all').checked, true);
  });

  test('seeds from excludedMembers, showing the complement', () => {
    mountExpenseSplit(host, { members, excludedMembers: ['m2'] });
    assert.deepEqual(checkedIds(), ['m1', 'm3']);
    assert.equal(host.querySelector('#xs-all').checked, false);
  });

  // The screen is include-based, the stored document is exclude-based. An
  // untouched edit modal must round-trip to the identical array or every
  // save would rewrite the field.
  test('an untouched widget returns the excludedMembers it was given', () => {
    const split = mountExpenseSplit(host, { members, excludedMembers: ['m2'] });
    assert.deepEqual(split.getExcludedMembers(), ['m2']);
  });

  test('unchecking a member adds them to the exclusions', () => {
    const split = mountExpenseSplit(host, { members });
    host.querySelector('.xs-m[data-id="m3"]').click();
    assert.deepEqual(split.getExcludedMembers(), ['m3']);
  });

  // Order follows `members`, not click order -- otherwise the same choice
  // serialises differently every time.
  test('exclusion order follows the member list, not the click order', () => {
    const split = mountExpenseSplit(host, { members });
    host.querySelector('.xs-m[data-id="m3"]').click();
    host.querySelector('.xs-m[data-id="m1"]').click();
    assert.deepEqual(split.getExcludedMembers(), ['m1', 'm3']);
  });

  test('전체 unchecks everyone, then rechecks everyone', () => {
    const split = mountExpenseSplit(host, { members });
    host.querySelector('#xs-all').click();
    assert.deepEqual(split.getExcludedMembers(), ['m1', 'm2', 'm3']);
    host.querySelector('#xs-all').click();
    assert.deepEqual(split.getExcludedMembers(), []);
  });

  test('전체 rechecks itself once the last member is checked back on', () => {
    mountExpenseSplit(host, { members, excludedMembers: ['m2'] });
    assert.equal(host.querySelector('#xs-all').checked, false);
    host.querySelector('.xs-m[data-id="m2"]').click();
    assert.equal(host.querySelector('#xs-all').checked, true);
  });

  // Each toggle rebuilds the subtree, so a listener bound to a destroyed node
  // must not keep firing -- a stacked handler would double-toggle.
  test('repeated toggling stays consistent across rerenders', () => {
    const split = mountExpenseSplit(host, { members });
    for (let i = 0; i < 5; i += 1) host.querySelector('.xs-m[data-id="m2"]').click();
    assert.deepEqual(split.getExcludedMembers(), ['m2']);
  });
});
