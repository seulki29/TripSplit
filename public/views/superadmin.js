import { callFunction, logout } from '../api.js';
import { getSession, setSession } from '../session.js';
import { openModal, closeModal, showToast, escapeHtml } from '../ui.js';

function mount(root) {
  const session = getSession();
  if (session && session.role === 'superadmin') {
    renderDashboard(root);
  } else {
    renderLogin(root);
  }
}

function renderLogin(root) {
  root.innerHTML = `
    <div class="container" style="max-width:360px;padding-top:4rem">
      <h2>Superadmin</h2>
      <div class="field">
        <label class="label">Password</label>
        <input type="password" class="input" id="sa-password" autocomplete="current-password" lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" style="ime-mode:disabled">
      </div>
      <button type="button" class="btn btn-primary btn-block" id="sa-login-btn">로그인</button>
      <p class="muted" id="sa-error" style="margin-top:0.75rem;font-size:13px"></p>
    </div>`;

  document.getElementById('sa-login-btn').addEventListener('click', async () => {
    const password = document.getElementById('sa-password').value;
    try {
      const result = await callFunction('verifySuperadminPassword', { password });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'superadmin', tripId: null, tripSlug: null, memberId: null });
      renderDashboard(root);
    } catch (err) {
      document.getElementById('sa-error').textContent = err.message;
    }
  });
}

async function renderDashboard(root) {
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>여행 목록</h2>
        <div>
          <button type="button" class="btn btn-primary" id="sa-new-trip">새 여행 만들기</button>
          <button type="button" class="btn btn-secondary" id="sa-logout">로그아웃</button>
        </div>
      </div>
      <div id="sa-trip-list"></div>
    </div>`;

  document.getElementById('sa-new-trip').addEventListener('click', () => openCreateTripModal(root));
  document.getElementById('sa-logout').addEventListener('click', logout);

  try {
    await loadTrips(root);
  } catch (err) {
    root.querySelector('#sa-trip-list').innerHTML = `<p class="muted" style="margin-top:1rem">여행 목록을 불러오지 못했습니다: ${escapeHtml(err.message)}</p>`;
  }
}

async function loadTrips(root) {
  const trips = await callFunction('listTrips', {});
  const listEl = root.querySelector('#sa-trip-list');
  if (trips.length === 0) {
    listEl.innerHTML = '<p class="muted" style="margin-top:1rem">아직 생성된 여행이 없습니다.</p>';
    return;
  }
  listEl.innerHTML = `
    <table style="width:100%;margin-top:1rem;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)">
        <th style="padding:0.5rem">이름</th><th>slug</th><th>그룹</th><th>상태</th><th></th>
      </tr></thead>
      <tbody>
        ${trips.map((t) => `
          <tr style="border-top:1px solid var(--rule)" data-trip-id="${t.id}">
            <td style="padding:0.6rem 0.5rem">${escapeHtml(t.name)}</td>
            <td class="mono">${escapeHtml(t.slug)}</td>
            <td>${escapeHtml(t.group)}</td>
            <td>${escapeHtml(t.status)}</td>
            <td><button type="button" class="btn btn-secondary sa-reissue" data-trip-id="${t.id}">PIN 재발급</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  listEl.querySelectorAll('.sa-reissue').forEach((btn) => {
    btn.addEventListener('click', () => openReissueModal(root, btn.dataset.tripId));
  });
}

function openCreateTripModal(root) {
  openModal('새 여행 만들기', `
    <div class="field"><label class="label">여행 이름</label><input class="input" id="ct-name"></div>
    <div class="field"><label class="label">slug (URL용)</label><input class="input" id="ct-slug"></div>
    <div class="field"><label class="label">그룹명</label><input class="input" id="ct-group"></div>
    <div class="field"><label class="label">관리자 PIN</label><input class="input" id="ct-admin-pin"></div>
    <div class="field"><label class="label">일반 PIN</label><input class="input" id="ct-member-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="ct-submit">생성</button>
    <p class="muted" id="ct-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('ct-submit').addEventListener('click', async () => {
    try {
      await callFunction('createTrip', {
        name: document.getElementById('ct-name').value,
        slug: document.getElementById('ct-slug').value,
        group: document.getElementById('ct-group').value,
        adminPin: document.getElementById('ct-admin-pin').value,
        memberPin: document.getElementById('ct-member-pin').value,
      });
      closeModal();
      showToast('여행이 생성되었습니다', 'success');
      try {
        await loadTrips(root);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      document.getElementById('ct-error').textContent = err.message;
    }
  });
}

function openReissueModal(root, tripId) {
  openModal('PIN 재발급', `
    <div class="field"><label class="label">새 관리자 PIN (선택)</label><input class="input" id="ri-admin-pin"></div>
    <div class="field"><label class="label">새 일반 PIN (선택)</label><input class="input" id="ri-member-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="ri-submit">저장</button>
    <p class="muted" id="ri-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('ri-submit').addEventListener('click', async () => {
    const patch = {};
    const adminPin = document.getElementById('ri-admin-pin').value;
    const memberPin = document.getElementById('ri-member-pin').value;
    if (adminPin) patch.adminPin = adminPin;
    if (memberPin) patch.memberPin = memberPin;

    if (Object.keys(patch).length === 0) {
      document.getElementById('ri-error').textContent = '변경할 PIN을 하나 이상 입력해주세요.';
      return;
    }

    try {
      await callFunction('updateTrip', { tripId, patch });
      closeModal();
      showToast('PIN이 재발급되었습니다. 기존 세션은 모두 로그아웃됩니다.', 'success');
      try {
        await loadTrips(root);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      document.getElementById('ri-error').textContent = err.message;
    }
  });
}

export { mount };
