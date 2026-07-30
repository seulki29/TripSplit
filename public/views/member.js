import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 } from '../ui.js';
import { renderReportInto } from './report.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비', '놀이', '기타'];
let currentTab = 'expenses';
let renderToken = 0;

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

function render(root, slug) {
  const myToken = ++renderToken;
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <p class="label"><a href="/" style="text-decoration:none;color:inherit">← TripSplit</a></p>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>내 여행</h2>
        <button type="button" class="btn btn-secondary" id="member-logout">로그아웃</button>
      </div>
      <div class="tabs">
        <button type="button" class="tab ${currentTab === 'expenses' ? 'active' : ''}" data-tab="expenses">경비목록</button>
        <button type="button" class="tab ${currentTab === 'members' ? 'active' : ''}" data-tab="members">구성원</button>
        <button type="button" class="tab ${currentTab === 'report' ? 'active' : ''}" data-tab="report">리포트</button>
      </div>
      <div id="member-tab-body"></div>
    </div>`;

  document.getElementById('member-logout').addEventListener('click', logout);

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  const body = root.querySelector('#member-tab-body');
  body.innerHTML = '<p class="muted">불러오는 중...</p>';
  if (currentTab === 'members') renderMembersTab(body, slug, myToken);
  else if (currentTab === 'report') renderReportInto(body, slug);
  else renderExpensesTab(body, slug, myToken);
}

async function renderExpensesTab(body, slug, myToken) {
  body.innerHTML = `
    <div style="margin-bottom:1rem"><button type="button" class="btn btn-primary" id="member-add-expense">경비 입력</button></div>
    <div id="member-expenses-list"></div>`;
  document.getElementById('member-add-expense').addEventListener('click', () => openExpenseModal(body, slug));
  await loadExpenses(body, slug, myToken);
}

async function loadExpenses(body, slug, myToken) {
  const session = getSession();
  let expenses, members;
  try {
    [expenses, members] = await Promise.all([
      callFunction('listExpenses', { tripId: session.tripId }),
      callFunction('listMembersForLogin', { slug }),
    ]);
  } catch (err) {
    if (myToken !== renderToken) return;
    body.querySelector('#member-expenses-list').innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="me-retry">다시 시도</button>`;
    body.querySelector('#me-retry').addEventListener('click', () => loadExpenses(body, slug, myToken));
    return;
  }
  if (myToken !== renderToken) return;
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  body.querySelector('#member-expenses-list').innerHTML = expenses.map((e) => {
    const isMine = e.enteredBy === session.memberId;
    const canEdit = isMine && !e.confirmed;
    return `
      <div class="card${e.photoPath ? ' expense-card-receipt' : ''}" data-id="${e.id}" style="margin-bottom:0.6rem;${e.confirmed ? 'opacity:0.7;' : ''}${e.photoPath ? 'cursor:pointer' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
          <div style="min-width:0">
            <span class="tag">${e.category}</span>
            <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
            <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
            ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">🔒 확정됨</span>' : ''}
            ${e.photoPath ? '<span class="muted" style="font-size:11px;margin-left:0.4rem">📷</span>' : ''}
          </div>
          ${canEdit ? `
          <div class="card-actions">
            <button type="button" class="btn btn-secondary member-edit" data-id="${e.id}">수정</button>
            <button type="button" class="btn btn-secondary member-delete" data-id="${e.id}">삭제</button>
          </div>` : ''}
        </div>
        <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}</p>
        ${e.excludedMembers && e.excludedMembers.length ? `<p class="muted" style="font-size:12px">제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</p>` : ''}
      </div>`;
  }).join('');

  body.querySelectorAll('.member-delete').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      btn.disabled = true;
      try {
        await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
        await loadExpenses(body, slug, myToken);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });

  body.querySelectorAll('.member-edit').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const exp = expenses.find((x) => x.id === btn.dataset.id);
      openMemberExpenseEditModal(body, slug, exp);
    });
  });

  body.querySelectorAll('.expense-card-receipt').forEach((card) => {
    card.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: card.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증 사진">`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderMembersTab(body, slug, myToken) {
  const session = getSession();
  let members;
  try {
    members = await callFunction('listMembers', { tripId: session.tripId });
  } catch (err) {
    if (myToken !== renderToken) return;
    body.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="tab-retry">다시 시도</button>`;
    body.querySelector('#tab-retry').addEventListener('click', () => renderMembersTab(body, slug, myToken));
    return;
  }
  if (myToken !== renderToken) return;

  body.innerHTML = members.map((m) => `
    <div class="card" style="margin-bottom:0.6rem">
      <strong>${escapeHtml(m.name)}</strong>
      <span class="muted" style="font-size:12px;margin-left:0.5rem">가중치 ${m.weight}${m.account ? ' · 계좌 ' + escapeHtml(m.account) : ''}</span>
    </div>`).join('');
}

function openExpenseModal(body, slug) {
  let category = CATEGORIES[1];
  let photoPath = null;
  let classifyPromise = null;
  let skipped = false;

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

  ['me-amount', 'me-merchant', 'me-detail'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('me-submit').click();
    });
  });

  document.getElementById('me-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    skipped = false;
    const mimeType = file.type;
    const b64 = await fileToBase64(file);
    document.getElementById('me-photo-preview').innerHTML =
      `<img src="data:${mimeType};base64,${b64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`
      + `<div id="me-classify-status" class="muted" style="font-size:13px;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">🔍 문자 추출 중…<button type="button" class="btn btn-secondary" id="me-classify-skip">건너뛰고 직접 입력</button></div>`;

    document.getElementById('me-classify-skip').addEventListener('click', () => {
      skipped = true;
      const s = document.getElementById('me-classify-status');
      if (s) s.remove();
    });

    const session = getSession();
    classifyPromise = callFunction('classifyReceipt', { tripId: session.tripId, photoBase64: b64, mimeType })
      .then((classification) => {
        photoPath = classification.photoPath || null;
        const s = document.getElementById('me-classify-status');
        if (s) s.remove();
        if (!skipped) {
          if (classification.classified === false) {
            showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
          } else {
            if (classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (classification.date) document.getElementById('me-date').value = classification.date;
            if (classification.amount) document.getElementById('me-amount').value = classification.amount;
            if (classification.merchant) document.getElementById('me-merchant').value = classification.merchant;
            if (classification.detail) document.getElementById('me-detail').value = classification.detail;
          }
        }
        return photoPath;
      })
      .catch(() => {
        const s = document.getElementById('me-classify-status');
        if (s) s.remove();
        showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
        return null;
      });
  });

  document.getElementById('me-submit').addEventListener('click', async () => {
    const session = getSession();
    const btn = document.getElementById('me-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      if (classifyPromise) {
        btn.textContent = '사진 저장 중...';
        await classifyPromise;
        btn.textContent = '저장 중...';
      }
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
      await loadExpenses(body, slug, renderToken);
    } catch (err) {
      btn.disabled = false; btn.textContent = '입력 완료';
      document.getElementById('me-error').textContent = err.message;
    }
  });
}

function openMemberExpenseEditModal(body, slug, exp) {
  let category = exp.category;
  const session = getSession();

  openModal('경비 수정', `
    <div class="field"><label class="label">카테고리</label><div id="mee-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="mee-date" value="${escapeHtml(exp.date || '')}"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="mee-amount" value="${Number(exp.amount) || ''}"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="mee-merchant" value="${escapeHtml(exp.merchant || '')}"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="mee-detail" value="${escapeHtml(exp.detail || '')}"></div>
    <button type="button" class="btn btn-primary btn-block" id="mee-submit">저장</button>
    <p class="muted" id="mee-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderChips() {
    renderChipGroup(document.getElementById('mee-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderChips();
    });
  }
  rerenderChips();

  ['mee-amount', 'mee-merchant', 'mee-detail'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mee-submit').click();
    });
  });

  document.getElementById('mee-submit').addEventListener('click', async () => {
    const btn = document.getElementById('mee-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      await callFunction('updateExpense', {
        tripId: session.tripId,
        expenseId: exp.id,
        patch: {
          category,
          date: document.getElementById('mee-date').value,
          amount: Number(document.getElementById('mee-amount').value),
          merchant: document.getElementById('mee-merchant').value,
          detail: document.getElementById('mee-detail').value,
        },
      });
      closeModal();
      await loadExpenses(body, slug, renderToken);
    } catch (err) {
      btn.disabled = false; btn.textContent = '저장';
      document.getElementById('mee-error').textContent = err.message;
    }
  });
}

export { mount };
