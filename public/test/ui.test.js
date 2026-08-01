import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.FileReader = dom.window.FileReader;

const { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 } = await import('../ui.js');

describe('ui.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('openModal creates the modal root, sets content, and opens it', () => {
    openModal('제목', '<p>내용</p>');
    const overlay = document.getElementById('modal-overlay');
    assert.ok(overlay.classList.contains('open'));
    assert.equal(overlay.querySelector('.modal-title').textContent, '제목');
    assert.equal(overlay.querySelector('.modal-body').innerHTML, '<p>내용</p>');
  });

  test('closeModal removes the open class without destroying the root', () => {
    openModal('제목', '내용');
    closeModal();
    const overlay = document.getElementById('modal-overlay');
    assert.equal(overlay.classList.contains('open'), false);
  });

  test('clicking the close button closes the modal', () => {
    openModal('제목', '내용');
    document.querySelector('.modal-close').click();
    assert.equal(document.getElementById('modal-overlay').classList.contains('open'), false);
  });

  test('clicking the overlay background (not the box) closes the modal', () => {
    openModal('제목', '내용');
    const overlay = document.getElementById('modal-overlay');
    overlay.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(overlay.classList.contains('open'), false);
  });

  test('showToast appends a toast element with the right class', () => {
    showToast('저장됨', 'success');
    const toast = document.querySelector('.toast');
    assert.ok(toast);
    assert.ok(toast.classList.contains('toast-success'));
    assert.equal(toast.textContent, '저장됨');
  });

  test('renderChipGroup renders one chip per option and marks the selected one', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비', '장보기', '교통비'], '식비', () => {});
    const chips = container.querySelectorAll('.chip');
    assert.equal(chips.length, 4);
    assert.ok(chips[1].classList.contains('chip-selected'));
    assert.equal(chips[0].classList.contains('chip-selected'), false);
  });

  test('renderChipGroup calls onSelect with the clicked option', () => {
    const container = document.createElement('div');
    let selected = null;
    renderChipGroup(container, ['숙박', '식비'], '숙박', (opt) => { selected = opt; });
    container.querySelectorAll('.chip')[1].click();
    assert.equal(selected, '식비');
  });

  test('renderChipGroup renders no dot when dotColor is omitted (existing callers unchanged)', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비'], '숙박', () => {});
    assert.equal(container.querySelectorAll('.cat-dot').length, 0);
    assert.equal(container.querySelectorAll('.chip')[0].textContent, '숙박');
  });

  test('renderChipGroup prepends a coloured dot when dotColor returns a colour', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비'], '숙박', () => {}, {
      dotColor: (opt) => (opt === '숙박' ? '#2a78d6' : '#eb6834'),
    });
    const dots = container.querySelectorAll('.cat-dot');
    assert.equal(dots.length, 2);
    // jsdom may serialise the colour as hex or as rgb() -- accept either.
    assert.match(dots[0].getAttribute('style'), /#2a78d6|rgb\(42,\s*120,\s*214\)/);
    // The label still reads as plain text -- the dot contributes none.
    assert.equal(container.querySelectorAll('.chip')[0].textContent, '숙박');
  });

  test('renderChipGroup skips the dot for an option whose dotColor is falsy', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비'], '숙박', () => {}, {
      dotColor: (opt) => (opt === '숙박' ? '#2a78d6' : null),
    });
    assert.equal(container.querySelectorAll('.cat-dot').length, 1);
  });

  test('renderChipGroup still fires onSelect when dots are enabled', () => {
    const container = document.createElement('div');
    let selected = null;
    renderChipGroup(container, ['숙박', '식비'], '숙박', (opt) => { selected = opt; }, {
      dotColor: () => '#2a78d6',
    });
    container.querySelectorAll('.chip')[1].click();
    assert.equal(selected, '식비');
  });

  test('clicking inside the modal box does not close the modal', () => {
    openModal('제목', '내용');
    document.querySelector('.modal-box').click();
    assert.equal(document.getElementById('modal-overlay').classList.contains('open'), true);
  });

  test('closeModal does nothing and does not throw when no modal has ever been opened', () => {
    assert.doesNotThrow(() => closeModal());
  });

  test('openModal sets dialog a11y attributes and Escape closes it', () => {
    openModal('테스트', '<input id="mx">');
    const box = document.querySelector('.modal-box');
    assert.equal(box.getAttribute('role'), 'dialog');
    assert.equal(box.getAttribute('aria-modal'), 'true');
    const overlay = document.getElementById('modal-overlay');
    assert.ok(overlay.classList.contains('open'));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.ok(!overlay.classList.contains('open'));
  });

  test('openModal sets aria-label to the title and focuses the first field', () => {
    openModal('제목입니다', '<input id="first-field"><input id="second-field">');
    const box = document.querySelector('.modal-box');
    assert.equal(box.getAttribute('aria-label'), '제목입니다');
    assert.equal(document.activeElement.id, 'first-field');
    closeModal();
  });

  test('closeModal returns focus to the element that was focused before openModal was called', () => {
    const opener = document.createElement('button');
    opener.id = 'opener-btn';
    document.body.appendChild(opener);
    opener.focus();
    openModal('제목', '<input id="mx">');
    closeModal();
    assert.equal(document.activeElement.id, 'opener-btn');
  });

  test('Escape after closeModal no longer triggers a close (listener is removed)', () => {
    openModal('제목', '<input id="mx">');
    closeModal();
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('open');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.ok(overlay.classList.contains('open'));
  });

  test('escapeHtml neutralizes HTML-significant characters', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(escapeHtml(`"quoted" & 'single'`), '&quot;quoted&quot; &amp; &#39;single&#39;');
  });

  test('openModal invokes onKeydown for non-Escape keys while open', () => {
    let received = null;
    openModal('제목', '내용', { onKeydown: (e) => { received = e.key; } });
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(received, 'ArrowRight');
    closeModal();
  });

  test('onKeydown does not fire for Escape (Escape still closes the modal)', () => {
    let calls = 0;
    openModal('제목', '내용', { onKeydown: () => { calls += 1; } });
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(calls, 0);
    assert.equal(document.getElementById('modal-overlay').classList.contains('open'), false);
  });

  test('a new openModal call replaces the previous onKeydown handler', () => {
    let calls = 0;
    openModal('제목', '내용', { onKeydown: () => { calls += 1; } });
    openModal('제목2', '내용2');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(calls, 0);
    closeModal();
  });

  test('fileToBase64 resolves with the base64 payload (no data-URL prefix)', async () => {
    const file = new dom.window.File([new dom.window.Blob(['hi'])], 'x.jpg', { type: 'image/jpeg' });
    const result = await fileToBase64(file);
    assert.equal(typeof result, 'string');
    assert.ok(!result.startsWith('data:'));
  });
});
