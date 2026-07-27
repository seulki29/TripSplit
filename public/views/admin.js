import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml } from '../ui.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];
let currentTab = 'setup';
let membersCache = [];
let renderToken = 0;

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.role !== 'admin' || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

function render(root, slug) {
  const myToken = ++renderToken;
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>관리자 콘솔</h2>
        <button type="button" class="btn btn-secondary" id="admin-logout">로그아웃</button>
      </div>
      <div class="tabs">
        <button type="button" class="tab ${currentTab === 'setup' ? 'active' : ''}" data-tab="setup">여행정보</button>
        <button type="button" class="tab ${currentTab === 'members' ? 'active' : ''}" data-tab="members">구성원</button>
        <button type="button" class="tab ${currentTab === 'expenses' ? 'active' : ''}" data-tab="expenses">경비확인</button>
        <button type="button" class="tab" data-tab="report">리포트</button>
      </div>
      <div id="admin-tab-body"></div>
    </div>`;

  document.getElementById('admin-logout').addEventListener('click', logout);

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'report') { location.href = `/t/${slug}/report`; return; }
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  const body = root.querySelector('#admin-tab-body');
  if (currentTab === 'setup') renderSetupTab(body, slug, myToken);
  else if (currentTab === 'members') renderMembersTab(body, slug, myToken);
  else renderExpensesTab(body, slug, myToken);
}

async function renderSetupTab(body, slug, myToken) {
  const session = getSession();
  const trip = await callFunction('getTripSetup', { tripId: session.tripId });
  if (myToken !== renderToken) return;

  body.innerHTML = `
    <div class="field"><label class="label">기간 시작</label><input type="date" class="input" id="setup-start" value="${escapeHtml(trip.period?.start || '')}"></div>
    <div class="field"><label class="label">기간 종료</label><input type="date" class="input" id="setup-end" value="${escapeHtml(trip.period?.end || '')}"></div>
    <div class="field"><label class="label">장소</label><input class="input" id="setup-location" value="${escapeHtml(trip.location || '')}"></div>
    <div class="field"><label class="label">숙박지</label><input class="input" id="setup-lodging" value="${escapeHtml(trip.lodging || '')}"></div>
    <button type="button" class="btn btn-primary" id="setup-save">저장</button>`;

  document.getElementById('setup-save').addEventListener('click', async () => {
    try {
      await callFunction('updateTripSetup', {
        tripId: session.tripId,
        patch: {
          period: { start: document.getElementById('setup-start').value, end: document.getElementById('setup-end').value },
          location: document.getElementById('setup-location').value,
          lodging: document.getElementById('setup-lodging').value,
        },
      });
      showToast('저장되었습니다', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function renderMembersTab(body, slug, myToken) {
  const session = getSession();
  membersCache = await callFunction('listMembers', { tripId: session.tripId });
  if (myToken !== renderToken) return;

  body.innerHTML = `
    <button type="button" class="btn btn-primary" id="members-add" style="margin-bottom:1rem">구성원 추가</button>
    <div id="members-list"></div>`;

  document.getElementById('members-add').addEventListener('click', () => openMemberModal(body, slug, null));
  renderMembersList(body, slug);
}

function renderMembersList(body, slug) {
  body.querySelector('#members-list').innerHTML = membersCache.map((m) => `
    <div class="card" style="margin-bottom:0.6rem;display:flex;justify-content:space-between;align-items:center">
      <div>
        <strong>${escapeHtml(m.name)}</strong>
        <span class="muted" style="font-size:12px;margin-left:0.5rem">가중치 ${m.weight}${m.excludedCategories.length ? ' · 제외: ' + escapeHtml(m.excludedCategories.join(', ')) : ''}</span>
      </div>
      <button type="button" class="btn btn-secondary member-edit" data-id="${m.id}">수정</button>
    </div>`).join('');

  body.querySelectorAll('.member-edit').forEach((btn) => {
    btn.addEventListener('click', () => openMemberModal(body, slug, membersCache.find((m) => m.id === btn.dataset.id)));
  });
}

function openMemberModal(body, slug, member) {
  const isEdit = !!member;
  openModal(isEdit ? '구성원 수정' : '구성원 추가', `
    <div class="field"><label class="label">이름</label><input class="input" id="mm-name" value="${escapeHtml(member?.name || '')}"></div>
    <div class="field"><label class="label">정산 가중치</label><input type="number" step="0.1" class="input" id="mm-weight" value="${member?.weight ?? 1}"></div>
    <div class="field">
      <label class="label">제외 카테고리</label>
      <div id="mm-excluded"></div>
    </div>
    <button type="button" class="btn btn-primary btn-block" id="mm-submit">${isEdit ? '저장' : '추가'}</button>
    <p class="muted" id="mm-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  let excluded = new Set(member?.excludedCategories || []);
  function renderExcludedChips() {
    document.querySelectorAll('#mm-excluded .chip').forEach((chip) => {
      chip.classList.toggle('chip-selected', excluded.has(chip.textContent));
    });
  }
  renderChipGroup(document.getElementById('mm-excluded'), CATEGORIES, null, (category) => {
    if (excluded.has(category)) excluded.delete(category); else excluded.add(category);
    renderExcludedChips();
  });
  renderExcludedChips();

  document.getElementById('mm-submit').addEventListener('click', async () => {
    const session = getSession();
    const name = document.getElementById('mm-name').value;
    const weight = Number(document.getElementById('mm-weight').value);
    try {
      if (isEdit) {
        await callFunction('updateMember', { tripId: session.tripId, memberId: member.id, patch: { name, weight, excludedCategories: [...excluded] } });
      } else {
        await callFunction('addMember', { tripId: session.tripId, name, weight, excludedCategories: [...excluded] });
      }
      closeModal();
      try {
        membersCache = await callFunction('listMembers', { tripId: session.tripId });
        renderMembersList(body, slug);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      document.getElementById('mm-error').textContent = err.message;
    }
  });
}

async function renderExpensesTab(body, slug, myToken) {
  const session = getSession();
  const [expenses, members] = await Promise.all([
    callFunction('listExpenses', { tripId: session.tripId }),
    callFunction('listMembersForLogin', { slug }),
  ]);
  if (myToken !== renderToken) return;

  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  body.innerHTML = `
    <button type="button" class="btn btn-primary" id="expense-add" style="margin-bottom:1rem">경비 입력</button>
    <div id="expenses-list"></div>`;

  document.getElementById('expenses-list').innerHTML = expenses.map((e) => `
    <div class="card" style="margin-bottom:0.6rem">
      <div style="display:flex;justify-content:space-between">
        <div>
          <span class="tag">${e.category}</span>
          <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
          <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
          ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">컴펌됨</span>' : ''}
        </div>
        <div>
          <button type="button" class="btn btn-secondary expense-confirm" data-id="${e.id}" data-confirmed="${e.confirmed}">${e.confirmed ? '컴펌 해제' : '컴펌'}</button>
          <button type="button" class="btn btn-danger expense-delete" data-id="${e.id}">삭제</button>
        </div>
      </div>
      <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}</p>
    </div>`).join('');

  body.querySelectorAll('.expense-confirm').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await callFunction('confirmExpense', { tripId: session.tripId, expenseId: btn.dataset.id, confirmed: btn.dataset.confirmed !== 'true' });
        await renderExpensesTab(body, slug, myToken);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
  body.querySelectorAll('.expense-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
        await renderExpensesTab(body, slug, myToken);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
  document.getElementById('expense-add').addEventListener('click', () => openAdminExpenseModal(body, slug, members));
}

function openAdminExpenseModal(body, slug, members) {
  let category = CATEGORIES[1];
  let photoBase64 = null;
  let mimeType = null;

  openModal('경비 입력', `
    <div class="field"><label class="label">사진</label><input type="file" accept="image/*" capture="environment" id="ae-photo"></div>
    <div id="ae-photo-preview"></div>
    <div class="field"><label class="label">입력 귀속 대상</label>
      <select class="input" id="ae-member">${members.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label class="label">카테고리</label><div id="ae-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="ae-date"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="ae-amount"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="ae-merchant"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="ae-detail"></div>
    <button type="button" class="btn btn-primary btn-block" id="ae-submit">입력 완료</button>
    <p class="muted" id="ae-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderCategoryChips() {
    renderChipGroup(document.getElementById('ae-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategoryChips();
    });
  }
  rerenderCategoryChips();

  document.getElementById('ae-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    mimeType = file.type;
    photoBase64 = await fileToBase64(file);
    document.getElementById('ae-photo-preview').innerHTML = `<img src="data:${mimeType};base64,${photoBase64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`;

    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      if (classification.category) { category = classification.category; rerenderCategoryChips(); }
      if (classification.date) document.getElementById('ae-date').value = classification.date;
      if (classification.amount) document.getElementById('ae-amount').value = classification.amount;
      if (classification.merchant) document.getElementById('ae-merchant').value = classification.merchant;
      if (classification.detail) document.getElementById('ae-detail').value = classification.detail;
      document.getElementById('ae-photo').dataset.photoUrl = classification.photoUrl;
    } catch (err) {
      showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
    }
  });

  document.getElementById('ae-submit').addEventListener('click', async () => {
    const session = getSession();
    try {
      await callFunction('addExpense', {
        tripId: session.tripId,
        enteredBy: document.getElementById('ae-member').value,
        category,
        date: document.getElementById('ae-date').value,
        amount: Number(document.getElementById('ae-amount').value),
        merchant: document.getElementById('ae-merchant').value,
        detail: document.getElementById('ae-detail').value,
        photoUrl: document.getElementById('ae-photo').dataset.photoUrl || null,
      });
      closeModal();
      try {
        await renderExpensesTab(body, slug, renderToken);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      document.getElementById('ae-error').textContent = err.message;
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
