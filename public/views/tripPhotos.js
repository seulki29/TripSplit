import { callFunction } from '../api.js';
import { getSession } from '../session.js';
import {
  openModal, closeModal, showToast, escapeHtml,
} from '../ui.js';
import { resizeImageFile } from '../imageResize.js';

const UPLOAD_LABEL = '사진 추가';

// The photo list is held in this closure rather than at module scope so two
// mounted views can never read each other's cache.
async function renderTripPhotosInto(container, tripId) {
  container.innerHTML = `
    <input type="file" accept="image/jpeg,image/png" id="tp-upload" multiple style="display:none">
    <button type="button" class="btn btn-secondary" id="tp-upload-btn" style="margin-bottom:0.6rem">${UPLOAD_LABEL}</button>
    <div id="tp-gallery"><p class="muted">불러오는 중...</p></div>`;

  const gallery = container.querySelector('#tp-gallery');
  const button = container.querySelector('#tp-upload-btn');
  const input = container.querySelector('#tp-upload');
  let photos = [];

  async function load() {
    try {
      const result = await callFunction('listTripPhotos', { tripId });
      photos = result.photos;
    } catch (err) {
      gallery.innerHTML = '<p class="muted">사진을 불러오지 못했습니다.</p>';
      return;
    }
    gallery.innerHTML = photos.length
      ? `<div class="tp-grid">${photos.map((p, i) => `<img src="${escapeHtml(p.url)}" data-index="${i}" class="tp-thumb" alt="여행사진">`).join('')}</div>`
      : '<p class="muted">여행사진이 없습니다.</p>';
    gallery.querySelectorAll('.tp-thumb').forEach((img) => {
      img.addEventListener('click', () => openAt(Number(img.dataset.index)));
    });
  }

  function openAt(index) {
    const photo = photos[index];
    if (!photo) return;
    const session = getSession();
    const canDelete = session.role === 'admin' || photo.uploadedBy === session.memberId;

    const step = (next) => { if (next >= 0 && next < photos.length) openAt(next); };

    openModal('여행사진', `
      <div class="tp-frame"><img src="${escapeHtml(photo.url)}" alt="여행사진"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.6rem">
        <button type="button" class="btn btn-secondary" id="tp-prev" ${index === 0 ? 'disabled' : ''}>◀ 이전</button>
        <span class="muted" style="font-size:12px">${index + 1} / ${photos.length}</span>
        <button type="button" class="btn btn-secondary" id="tp-next" ${index === photos.length - 1 ? 'disabled' : ''}>다음 ▶</button>
      </div>
      ${canDelete ? '<button type="button" class="btn btn-danger btn-block" id="tp-delete" style="margin-top:0.6rem">삭제</button>' : ''}`, {
      onKeydown: (e) => {
        if (e.key === 'ArrowLeft') step(index - 1);
        if (e.key === 'ArrowRight') step(index + 1);
      },
    });

    document.getElementById('tp-prev').addEventListener('click', () => step(index - 1));
    document.getElementById('tp-next').addEventListener('click', () => step(index + 1));

    const deleteButton = document.getElementById('tp-delete');
    if (!deleteButton) return;
    deleteButton.addEventListener('click', async () => {
      deleteButton.disabled = true;
      deleteButton.textContent = '삭제 중...';
      try {
        await callFunction('deleteTripPhoto', { tripId, photoId: photo.id });
        closeModal();
        await load();
        showToast('사진이 삭제되었습니다', 'success');
      } catch (err) {
        deleteButton.disabled = false;
        deleteButton.textContent = '삭제';
        showToast(err.message, 'error');
      }
    });
  }

  // Sequential, not parallel: a phone uploading eight full-size photos at once
  // runs out of memory and sockets. One failure must not abandon the rest.
  async function uploadAll(files) {
    button.disabled = true;
    let uploaded = 0;
    let lastError = null;
    for (let i = 0; i < files.length; i += 1) {
      button.textContent = `올리는 중 ${i + 1}/${files.length}...`;
      try {
        const { base64, mimeType } = await resizeImageFile(files[i]);
        await callFunction('addTripPhoto', { tripId, photoBase64: base64, mimeType });
        uploaded += 1;
      } catch (err) {
        lastError = err;
      }
    }
    button.disabled = false;
    button.textContent = UPLOAD_LABEL;
    await load();

    if (uploaded === files.length) showToast(`${uploaded}장이 추가되었습니다`, 'success');
    else if (uploaded > 0) showToast(`${files.length}장 중 ${uploaded}장 업로드 (${files.length - uploaded}장 실패)`, 'error');
    else showToast(lastError ? lastError.message : '업로드에 실패했습니다', 'error');
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    try {
      await uploadAll(files);
    } finally {
      e.target.value = ''; // let the same file be picked again
    }
  });

  await load();
}

export { renderTripPhotosInto };
