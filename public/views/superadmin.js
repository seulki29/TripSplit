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
      <p class="label"><a href="/" style="text-decoration:none;color:inherit">← TripSplit</a></p>
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
    const btn = document.getElementById('sa-login-btn');
    btn.disabled = true; btn.textContent = '로그인 중...';
    try {
      const result = await callFunction('verifySuperadminPassword', { password });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'superadmin', tripId: null, tripSlug: null, memberId: null });
      renderDashboard(root);
    } catch (err) {
      btn.disabled = false; btn.textContent = '로그인';
      document.getElementById('sa-error').textContent = err.message;
    }
  });

  document.getElementById('sa-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('sa-login-btn').click();
  });
}

async function renderDashboard(root) {
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <p class="label"><a href="/" style="text-decoration:none;color:inherit">← TripSplit</a></p>
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
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-secondary sa-reissue" data-trip-id="${t.id}">PIN 재발급</button>
              <button type="button" class="btn btn-danger sa-delete" data-trip-id="${t.id}">삭제</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  listEl.querySelectorAll('.sa-reissue').forEach((btn) => {
    btn.addEventListener('click', () => openReissueModal(root, btn.dataset.tripId));
  });

  listEl.querySelectorAll('.sa-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const trip = trips.find((t) => t.id === btn.dataset.tripId);
      openDeleteTripModal(root, btn.dataset.tripId, trip?.name || '');
    });
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
    const btn = document.getElementById('ct-submit');
    btn.disabled = true; btn.textContent = '생성 중...';
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
      btn.disabled = false; btn.textContent = '생성';
      document.getElementById('ct-error').textContent = err.message;
    }
  });

  ['ct-name', 'ct-slug', 'ct-group', 'ct-admin-pin', 'ct-member-pin'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('ct-submit').click();
    });
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

    const btn = document.getElementById('ri-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
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
      btn.disabled = false; btn.textContent = '저장';
      document.getElementById('ri-error').textContent = err.message;
    }
  });

  ['ri-admin-pin', 'ri-member-pin'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('ri-submit').click();
    });
  });
}

function openDeleteTripModal(root, tripId, tripName) {
  openModal('여행 삭제', `
    <p>정말 <strong>${escapeHtml(tripName)}</strong> 여행을 삭제하시겠습니까?</p>
    <p class="muted" style="font-size:13px;margin-top:0.5rem">모든 경비, 구성원 데이터가 영구적으로 삭제되며 되돌릴 수 없습니다.</p>
    <button type="button" class="btn btn-danger btn-block" id="dt-confirm" style="margin-top:1rem">삭제</button>
    <p class="muted" id="dt-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('dt-confirm').addEventListener('click', async () => {
    const btn = document.getElementById('dt-confirm');
    btn.disabled = true; btn.textContent = '삭제 중...';
    try {
      await callFunction('archiveTrip', { tripId });
      closeModal();
      showToast('여행이 삭제되었습니다', 'success');
      try {
        await loadTrips(root);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      btn.disabled = false; btn.textContent = '삭제';
      document.getElementById('dt-error').textContent = err.message;
    }
  });
}

export { mount };
