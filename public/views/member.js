import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml } from '../ui.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

async function render(root, slug) {
  const session = getSession();
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>경비 목록</h2>
        <div>
          <button type="button" class="btn btn-primary" id="member-add-expense">경비 입력</button>
          <button type="button" class="btn btn-secondary" id="member-logout">로그아웃</button>
        </div>
      </div>
      <div id="member-expenses-list" style="margin-top:1rem"></div>
      <p class="center" style="margin-top:2rem"><a href="/t/${slug}/report">리포트 보기 →</a></p>
    </div>`;

  document.getElementById('member-add-expense').addEventListener('click', () => openExpenseModal(root, slug));
  document.getElementById('member-logout').addEventListener('click', logout);
  await loadExpenses(root, slug);
}

async function loadExpenses(root, slug) {
  const session = getSession();
  const [expenses, members] = await Promise.all([
    callFunction('listExpenses', { tripId: session.tripId }),
    callFunction('listMembersForLogin', { slug }),
  ]);
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  root.querySelector('#member-expenses-list').innerHTML = expenses.map((e) => {
    const isMine = e.enteredBy === session.memberId;
    const canEdit = isMine && !e.confirmed;
    return `
      <div class="card" style="margin-bottom:0.6rem;${e.confirmed ? 'opacity:0.7' : ''}">
        <div style="display:flex;justify-content:space-between">
          <div>
            <span class="tag">${e.category}</span>
            <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
            <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
            ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">🔒 컴펌됨</span>' : ''}
          </div>
          ${canEdit ? `<button type="button" class="btn btn-secondary member-delete" data-id="${e.id}">삭제</button>` : ''}
        </div>
        <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}</p>
      </div>`;
  }).join('');

  root.querySelectorAll('.member-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
        await loadExpenses(root, slug);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function openExpenseModal(root, slug) {
  let category = CATEGORIES[1];
  let photoPath = null;

  openModal('경비 입력', `
    <div class="field"><label class="label">사진</label><input type="file" accept="image/*" id="me-photo"></div>
    <div id="me-photo-preview"></div>
    <div class="field"><label class="label">카테고리</label><div id="me-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="me-date"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="me-amount"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="me-merchant"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="me-detail"></div>
    <button type="button" class="btn btn-primary btn-block" id="me-submit">입력 완료</button>
    <p class="muted" id="me-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderCategoryChips() {
    renderChipGroup(document.getElementById('me-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategoryChips();
    });
  }
  rerenderCategoryChips();

  document.getElementById('me-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const mimeType = file.type;
    const photoBase64 = await fileToBase64(file);
    document.getElementById('me-photo-preview').innerHTML = `<img src="data:${mimeType};base64,${photoBase64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`;

    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      photoPath = classification.photoPath;
      if (classification.classified === false) {
        showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
      } else {
        if (classification.category) { category = classification.category; rerenderCategoryChips(); }
        if (classification.date) document.getElementById('me-date').value = classification.date;
        if (classification.amount) document.getElementById('me-amount').value = classification.amount;
        if (classification.merchant) document.getElementById('me-merchant').value = classification.merchant;
        if (classification.detail) document.getElementById('me-detail').value = classification.detail;
      }
    } catch (err) {
      showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
    }
  });

  document.getElementById('me-submit').addEventListener('click', async () => {
    const session = getSession();
    try {
      await callFunction('addExpense', {
        tripId: session.tripId,
        category,
        date: document.getElementById('me-date').value,
        amount: Number(document.getElementById('me-amount').value),
        merchant: document.getElementById('me-merchant').value,
        detail: document.getElementById('me-detail').value,
        photoPath,
      });
      closeModal();
      await loadExpenses(document.getElementById('app'), slug);
    } catch (err) {
      document.getElementById('me-error').textContent = err.message;
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export { mount };
