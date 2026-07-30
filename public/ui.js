let lastFocused = null;
let escHandler = null;

function getModalRoot() {
  let overlay = document.getElementById('modal-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title"></span>
        <button type="button" class="modal-close" aria-label="닫기">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  document.body.appendChild(overlay);
  return overlay;
}

function openModal(titleHTML, bodyHTML, { onKeydown } = {}) {
  const overlay = getModalRoot();
  const box = overlay.querySelector('.modal-box');
  overlay.querySelector('.modal-title').textContent = titleHTML;
  box.setAttribute('aria-label', String(titleHTML));
  overlay.querySelector('.modal-body').innerHTML = bodyHTML;
  overlay.classList.add('open');

  if (escHandler) document.removeEventListener('keydown', escHandler);
  lastFocused = document.activeElement;
  escHandler = (e) => {
    if (e.key === 'Escape') { closeModal(); return; }
    if (onKeydown) onKeydown(e);
  };
  document.addEventListener('keydown', escHandler);

  const first = overlay.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button');
  if (first) first.focus();
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  if (lastFocused && typeof lastFocused.focus === 'function') { lastFocused.focus(); lastFocused = null; }
}

function showToast(message, kind = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function renderChipGroup(container, options, selected, onSelect) {
  container.innerHTML = '';
  container.className = 'chip-group';
  options.forEach((opt) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (opt === selected ? ' chip-selected' : '');
    chip.textContent = opt;
    chip.addEventListener('click', () => onSelect(opt));
    container.appendChild(chip);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 };
