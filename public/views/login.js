import { callFunction } from '../api.js';
import { setSession } from '../session.js';
import { escapeHtml } from '../ui.js';

let currentTab = 'admin';
let renderToken = 0;

function mount(root, { slug }) {
  render(root, slug);
}

function render(root, slug) {
  const myToken = ++renderToken;

  root.innerHTML = `
    <div class="container" style="max-width:360px;padding-top:4rem">
      <h2>여행 로그인</h2>
      <div class="tabs">
        <button type="button" class="tab ${currentTab === 'admin' ? 'active' : ''}" data-tab="admin">관리자로 입장</button>
        <button type="button" class="tab ${currentTab === 'member' ? 'active' : ''}" data-tab="member">참가자로 입장</button>
      </div>
      <div id="login-form"></div>
      <p class="muted" id="login-error" style="margin-top:0.75rem;font-size:13px"></p>
    </div>`;

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  if (currentTab === 'admin') renderAdminForm(root, slug, myToken);
  else renderMemberForm(root, slug, myToken);
}

function renderAdminForm(root, slug, myToken) {
  root.querySelector('#login-form').innerHTML = `
    <div class="field"><label class="label">관리자 PIN</label><input type="password" class="input" id="login-admin-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="login-admin-submit">입장</button>`;

  document.getElementById('login-admin-submit').addEventListener('click', async () => {
    const btn = document.getElementById('login-admin-submit');
    btn.disabled = true; btn.textContent = '입장 중...';
    try {
      const result = await callFunction('verifyAdminPin', { slug, pin: document.getElementById('login-admin-pin').value });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'admin', tripId: result.tripId ?? null, tripSlug: slug, memberId: null });
      location.href = `/t/${slug}/admin`;
    } catch (err) {
      if (myToken !== renderToken) return;
      btn.disabled = false; btn.textContent = '입장';
      document.getElementById('login-error').textContent = err.message;
    }
  });

  document.getElementById('login-admin-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-admin-submit').click();
  });
}

async function renderMemberForm(root, slug, myToken) {
  const formEl = root.querySelector('#login-form');
  formEl.innerHTML = `<p class="muted">구성원 목록을 불러오는 중...</p>`;

  let members = [];
  try {
    members = await callFunction('listMembersForLogin', { slug });
  } catch (err) {
    if (myToken !== renderToken) return;
    formEl.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }

  if (myToken !== renderToken) return;

  formEl.innerHTML = `
    <div class="field">
      <label class="label">이름</label>
      <select class="input" id="login-member-select">
        <option value="">선택하세요</option>
        ${members.map((m) => `<option value="${m.id}" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label class="label">일반 PIN</label><input type="password" class="input" id="login-member-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="login-member-submit">입장</button>`;

  document.getElementById('login-member-submit').addEventListener('click', async () => {
    const select = document.getElementById('login-member-select');
    const name = select.selectedOptions[0]?.dataset.name;
    if (!name) {
      document.getElementById('login-error').textContent = '이름을 선택해주세요.';
      return;
    }
    const btn = document.getElementById('login-member-submit');
    btn.disabled = true; btn.textContent = '입장 중...';
    try {
      const result = await callFunction('verifyMemberPin', { slug, name, pin: document.getElementById('login-member-pin').value });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'member', tripId: result.tripId ?? null, tripSlug: slug, memberId: result.memberId ?? null });
      location.href = `/t/${slug}`;
    } catch (err) {
      if (myToken !== renderToken) return;
      btn.disabled = false; btn.textContent = '입장';
      document.getElementById('login-error').textContent = err.message;
    }
  });

  document.getElementById('login-member-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-member-submit').click();
  });
}

export { mount };
