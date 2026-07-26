import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { openModal, closeModal, showToast, renderChipGroup } = await import('../ui.js');

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
});
