function getModalRoot() {
  let overlay = document.getElementById('modal-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
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

function openModal(titleHTML, bodyHTML) {
  const overlay = getModalRoot();
  overlay.querySelector('.modal-title').textContent = titleHTML;
  overlay.querySelector('.modal-body').innerHTML = bodyHTML;
  overlay.classList.add('open');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
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

export { openModal, closeModal, showToast, renderChipGroup };
