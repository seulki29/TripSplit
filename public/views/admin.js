import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml } from '../ui.js';
import { renderReportInto } from './report.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];
let currentTab = 'setup';
let membersCache = [];
let renderToken = 0;
let exclusionMode = false;

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
        <button type="button" class="tab ${currentTab === 'report' ? 'active' : ''}" data-tab="report">리포트</button>
      </div>
      <div id="admin-tab-body"></div>
    </div>`;

  document.getElementById('admin-logout').addEventListener('click', logout);

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  const body = root.querySelector('#admin-tab-body');
  body.innerHTML = '<p class="muted">불러오는 중...</p>';
  if (currentTab === 'setup') renderSetupTab(body, slug, myToken);
  else if (currentTab === 'members') renderMembersTab(body, slug, myToken);
  else if (currentTab === 'report') renderReportInto(body, slug);
  else renderExpensesTab(body, slug, myToken);
}

async function renderSetupTab(body, slug, myToken) {
  const session = getSession();
  let trip;
  try {
    trip = await callFunction('getTripSetup', { tripId: session.tripId });
  } catch (err) {
    if (myToken !== renderToken) return;
    body.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="tab-retry">다시 시도</button>`;
    body.querySelector('#tab-retry').addEventListener('click', () => renderSetupTab(body, slug, myToken));
    return;
  }
  if (myToken !== renderToken) return;

  body.innerHTML = `
    <div class="field"><label class="label">기간 시작</label><input type="date" class="input" id="setup-start" value="${escapeHtml(trip.period?.start || '')}"></div>
    <div class="field"><label class="label">기간 종료</label><input type="date" class="input" id="setup-end" value="${escapeHtml(trip.period?.end || '')}"></div>
    <div class="field"><label class="label">장소</label><input class="input" id="setup-location" value="${escapeHtml(trip.location || '')}"></div>
    <div class="field"><label class="label">숙박지</label><input class="input" id="setup-lodging" value="${escapeHtml(trip.lodging || '')}"></div>
    <button type="button" class="btn btn-primary" id="setup-save">저장</button>`;

  document.getElementById('setup-save').addEventListener('click', async () => {
    const btn = document.getElementById('setup-save');
    btn.disabled = true; btn.textContent = '저장 중...';
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
      btn.disabled = false; btn.textContent = '저장';
    } catch (err) {
      btn.disabled = false; btn.textContent = '저장';
      showToast(err.message, 'error');
    }
  });
}

async function renderMembersTab(body, slug, myToken) {
  const session = getSession();
  try {
    membersCache = await callFunction('listMembers', { tripId: session.tripId });
  } catch (err) {
    if (myToken !== renderToken) return;
    body.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="tab-retry">다시 시도</button>`;
    body.querySelector('#tab-retry').addEventListener('click', () => renderMembersTab(body, slug, myToken));
    return;
  }
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
        <span class="muted" style="font-size:12px;margin-left:0.5rem">가중치 ${m.weight}${m.account ? ' · 계좌 ' + escapeHtml(m.account) : ''}</span>
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
    <div class="field"><label class="label">계좌 (선택)</label><input class="input" id="mm-account" value="${escapeHtml(member?.account || '')}"></div>
    <button type="button" class="btn btn-primary btn-block" id="mm-submit">${isEdit ? '저장' : '추가'}</button>
    <p class="muted" id="mm-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  ['mm-name', 'mm-weight', 'mm-account'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mm-submit').click();
    });
  });

  document.getElementById('mm-submit').addEventListener('click', async () => {
    const session = getSession();
    const btn = document.getElementById('mm-submit');
    const name = document.getElementById('mm-name').value;
    const weight = Number(document.getElementById('mm-weight').value);
    const account = document.getElementById('mm-account').value.trim();
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      if (isEdit) {
        await callFunction('updateMember', { tripId: session.tripId, memberId: member.id, patch: { name, weight, account } });
      } else {
        await callFunction('addMember', { tripId: session.tripId, name, weight, account });
      }
      closeModal();
      try {
        membersCache = await callFunction('listMembers', { tripId: session.tripId });
        renderMembersList(body, slug);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      btn.disabled = false; btn.textContent = isEdit ? '저장' : '추가';
      document.getElementById('mm-error').textContent = err.message;
    }
  });
}

async function renderExpensesTab(body, slug, myToken) {
  const session = getSession();
  let expenses, members;
  try {
    [expenses, members] = await Promise.all([
      callFunction('listExpenses', { tripId: session.tripId }),
      callFunction('listMembersForLogin', { slug }),
    ]);
  } catch (err) {
    if (myToken !== renderToken) return;
    body.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="tab-retry">다시 시도</button>`;
    body.querySelector('#tab-retry').addEventListener('click', () => renderExpensesTab(body, slug, myToken));
    return;
  }
  if (myToken !== renderToken) return;

  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  body.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
      <button type="button" class="btn btn-primary" id="expense-add">경비 입력</button>
      <button type="button" class="btn btn-secondary" id="expense-exclusion-toggle">${exclusionMode ? '제외설정 취소' : '제외설정'}</button>
    </div>
    ${exclusionMode ? `
      <div class="card" style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center">
        <button type="button" class="btn btn-primary" id="expense-exclusion-apply">제외 구성원 지정</button>
        <button type="button" class="btn btn-secondary" id="expense-exclusion-cancel">취소</button>
      </div>` : ''}
    <div id="expenses-list"></div>`;

  document.getElementById('expenses-list').innerHTML = expenses.map((e) => `
    <div class="card" style="margin-bottom:0.6rem">
      <div style="display:flex;justify-content:space-between">
        <div>
          ${exclusionMode ? `<input type="checkbox" class="excl-check" data-id="${e.id}" style="margin-right:0.5rem">` : ''}
          <span class="tag">${e.category}</span>
          <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
          <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
          ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">확정됨</span>' : ''}
        </div>
        <div>
          <button type="button" class="btn btn-secondary expense-confirm" data-id="${e.id}" data-confirmed="${e.confirmed}">${e.confirmed ? '확정 해제' : '확정'}</button>
          ${e.photoPath ? `<button type="button" class="btn btn-secondary expense-receipt" data-id="${e.id}">영수증</button>` : ''}
          <button type="button" class="btn btn-danger expense-delete" data-id="${e.id}">삭제</button>
        </div>
      </div>
      <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}</p>
      ${e.excludedMembers && e.excludedMembers.length ? `<p class="muted" style="font-size:12px">제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</p>` : ''}
    </div>`).join('');

  body.querySelectorAll('.expense-confirm').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await callFunction('confirmExpense', { tripId: session.tripId, expenseId: btn.dataset.id, confirmed: btn.dataset.confirmed !== 'true' });
        await renderExpensesTab(body, slug, myToken);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });
  body.querySelectorAll('.expense-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
        await renderExpensesTab(body, slug, myToken);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });
  body.querySelectorAll('.expense-receipt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: btn.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증 사진">`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
  document.getElementById('expense-add').addEventListener('click', () => openAdminExpenseModal(body, slug, members));

  document.getElementById('expense-exclusion-toggle').addEventListener('click', () => {
    exclusionMode = !exclusionMode;
    renderExpensesTab(body, slug, myToken);
  });

  if (exclusionMode) {
    document.getElementById('expense-exclusion-cancel').addEventListener('click', () => {
      exclusionMode = false;
      renderExpensesTab(body, slug, myToken);
    });
    document.getElementById('expense-exclusion-apply').addEventListener('click', () => {
      const checkedIds = [...body.querySelectorAll('.excl-check:checked')].map((c) => c.dataset.id);
      if (checkedIds.length === 0) {
        showToast('경비를 선택해주세요', 'error');
        return;
      }
      openExclusionModal(body, slug, members, expenses, checkedIds);
    });
  }
}

function openExclusionModal(body, slug, members, expenses, checkedIds) {
  let preCheckedIds = [];
  if (checkedIds.length === 1) {
    const target = expenses.find((e) => e.id === checkedIds[0]);
    preCheckedIds = target?.excludedMembers || [];
  }

  openModal('제외 구성원 지정', `
    ${members.map((m) => `<label style="display:block"><input type="checkbox" class="excl-member" value="${m.id}" ${preCheckedIds.includes(m.id) ? 'checked' : ''}> ${escapeHtml(m.name)}</label>`).join('')}
    <button type="button" class="btn btn-primary btn-block" id="excl-apply" style="margin-top:1rem">적용</button>
    <p class="muted" id="excl-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('excl-apply').addEventListener('click', async () => {
    const session = getSession();
    const btn = document.getElementById('excl-apply');
    const pickedMemberIds = [...document.querySelectorAll('.excl-member:checked')].map((c) => c.value);
    btn.disabled = true; btn.textContent = '적용 중...';
    try {
      await callFunction('setExpenseExclusions', { tripId: session.tripId, expenseIds: checkedIds, excludedMemberIds: pickedMemberIds });
      closeModal();
      exclusionMode = false;
      await renderExpensesTab(body, slug, renderToken);
    } catch (err) {
      btn.disabled = false; btn.textContent = '적용';
      const errEl = document.getElementById('excl-error');
      if (errEl) errEl.textContent = err.message;
      showToast(err.message, 'error');
    }
  });
}

function openAdminExpenseModal(body, slug, members) {
  let category = CATEGORIES[1];
  let photoBase64 = null;
  let mimeType = null;

  openModal('경비 입력', `
    <div class="field"><label class="label">사진</label><input type="file" accept="image/*" id="ae-photo"></div>
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

  ['ae-amount', 'ae-merchant', 'ae-detail'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('ae-submit').click();
    });
  });

  document.getElementById('ae-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    mimeType = file.type;
    photoBase64 = await fileToBase64(file);
    document.getElementById('ae-photo-preview').innerHTML = `<img src="data:${mimeType};base64,${photoBase64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`;

    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      document.getElementById('ae-photo').dataset.photoPath = classification.photoPath;
      if (classification.classified === false) {
        showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
      } else {
        if (classification.category) { category = classification.category; rerenderCategoryChips(); }
        if (classification.date) document.getElementById('ae-date').value = classification.date;
        if (classification.amount) document.getElementById('ae-amount').value = classification.amount;
        if (classification.merchant) document.getElementById('ae-merchant').value = classification.merchant;
        if (classification.detail) document.getElementById('ae-detail').value = classification.detail;
      }
    } catch (err) {
      showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
    }
  });

  document.getElementById('ae-submit').addEventListener('click', async () => {
    const session = getSession();
    const btn = document.getElementById('ae-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      await callFunction('addExpense', {
        tripId: session.tripId,
        enteredBy: document.getElementById('ae-member').value,
        category,
        date: document.getElementById('ae-date').value,
        amount: Number(document.getElementById('ae-amount').value),
        merchant: document.getElementById('ae-merchant').value,
        detail: document.getElementById('ae-detail').value,
        photoPath: document.getElementById('ae-photo').dataset.photoPath || null,
      });
      closeModal();
      try {
        await renderExpensesTab(body, slug, renderToken);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      btn.disabled = false; btn.textContent = '입력 완료';
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
