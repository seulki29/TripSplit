import { callFunction } from '../api.js';
import { getSession } from '../session.js';
import { openModal, showToast, escapeHtml } from '../ui.js';

const CATEGORY_COLORS = {
  숙박: '#1a4a6b',
  식비: '#2d7aaa',
  장보기: '#c4874a',
  교통비: '#8a3a1a',
};

async function renderReportInto(container, slug) {
  const session = getSession();
  container.innerHTML = '<p class="muted">불러오는 중...</p>';

  let data;
  try {
    data = await callFunction('getReportData', { tripId: session.tripId });
  } catch (err) {
    container.innerHTML = `<p class="muted">리포트를 불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="report-retry">다시 시도</button>`;
    const rb = container.querySelector('#report-retry');
    if (rb) rb.addEventListener('click', () => renderReportInto(container, slug));
    return;
  }
  const { trip, members, expenses, settlement, currentCategoryAverages, groupCategoryAverages, tripsInComparison } = data;
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const confirmedExpenses = expenses.filter((e) => e.confirmed);

  container.innerHTML = `
    <p class="label">Travel Expense Report</p>
    <h1>${escapeHtml(trip.name)}</h1>
    <p class="muted">${escapeHtml(trip.period?.start || '')} — ${escapeHtml(trip.period?.end || '')} · ${escapeHtml(trip.location || '')} · ${escapeHtml(trip.lodging || '')}</p>

    <div class="section"><h2>정산 조건</h2>
      <p class="muted" style="font-size:13px">확정된 지출만 집계합니다. 각 지출은 제외되지 않은 구성원끼리 가중치 비율로 분담하고, 실제 결제액과 비교해 받을 돈/낼 돈을 계산합니다.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:0.6rem">
        <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)"><th style="padding:0.4rem">구성원</th><th style="text-align:right">가중치</th></tr></thead>
        <tbody>${members.map((m) => `<tr style="border-top:1px solid var(--rule)"><td style="padding:0.4rem">${escapeHtml(m.name)}</td><td style="text-align:right" class="mono">${m.weight}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="section"><h2>전체 지출 내역</h2>${renderExpenseTable(confirmedExpenses, nameById)}</div>
    <div class="section"><h2>카테고리 분석</h2>
      ${renderDonutChart(settlement.categoryTotals)}
      ${tripsInComparison > 0 ? renderComparisonBars(currentCategoryAverages, groupCategoryAverages) : '<p class="muted">비교할 과거 여행이 아직 없습니다.</p>'}
    </div>
    <div class="section"><h2>결제자별 지출</h2>${renderPayerSummary(settlement.perMember)}</div>
    <div class="section"><h2>최종 정산</h2>${renderSettlement(settlement.perMember, session.role === 'admin')}</div>
    <div class="section"><h2>영수증 갤러리</h2><div id="report-gallery"><p class="muted">불러오는 중...</p></div></div>`;

  container.querySelectorAll('.report-receipt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: btn.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증">`);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  container.querySelectorAll('.settle-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await callFunction('setMemberSettled', { tripId: session.tripId, memberId: btn.dataset.id, settled: btn.dataset.settled !== 'true' });
        await renderReportInto(container, slug);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  try {
    const { urls } = await callFunction('listReceiptUrls', { tripId: session.tripId });
    const gal = container.querySelector('#report-gallery');
    if (gal) {
      gal.innerHTML = urls.length
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px">${urls.map((u) => `<img src="${escapeHtml(u.url)}" data-id="${u.expenseId}" class="gallery-thumb" style="width:100%;height:90px;object-fit:cover;border-radius:4px;cursor:pointer" alt="영수증">`).join('')}</div>`
        : '<p class="muted">영수증 사진이 없습니다.</p>';
      gal.querySelectorAll('.gallery-thumb').forEach((img) => img.addEventListener('click', () => openModal('영수증', `<img src="${escapeHtml(img.src)}" style="width:100%;border-radius:4px" alt="영수증">`)));
    }
  } catch (err) {
    const gal = container.querySelector('#report-gallery');
    if (gal) gal.innerHTML = '<p class="muted">갤러리를 불러오지 못했습니다.</p>';
  }
}

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) { location.href = `/t/${slug}`; return; }
  const backHref = session.role === 'admin' ? `/t/${slug}/admin` : `/t/${slug}`;
  root.innerHTML = `<div class="container" style="padding-top:2rem"><p class="center"><a href="${backHref}">← 돌아가기</a></p><div id="report-body"></div></div>`;
  renderReportInto(document.getElementById('report-body'), slug);
}

function renderExpenseTable(expenses, nameById) {
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)">
        <th style="padding:0.5rem">날짜</th><th>카테고리</th><th>내용</th><th>결제자</th><th style="text-align:right">금액</th>
      </tr></thead>
      <tbody>
        ${expenses.map((e) => `
          <tr style="border-top:1px solid var(--rule)">
            <td style="padding:0.6rem 0.5rem">${escapeHtml(e.date)}</td>
            <td><span class="tag">${e.category}</span></td>
            <td>${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}
              ${e.excludedMembers && e.excludedMembers.length ? `<span class="muted" style="font-size:11px">· 제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</span>` : ''}
              ${e.photoPath ? `<button type="button" class="report-receipt" data-id="${e.id}" style="font-size:11px;background:none;border:none;color:var(--accent);cursor:pointer">영수증</button>` : ''}
            </td>
            <td>${escapeHtml(nameById[e.enteredBy] || '?')}</td>
            <td style="text-align:right" class="mono">${Number(e.amount).toLocaleString()}원</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderDonutChart(categoryTotals) {
  const total = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  if (total <= 0) return '<p class="muted">지출 내역이 없습니다.</p>';

  const r = 40;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = Object.entries(categoryTotals).map(([category, amount]) => {
    const fraction = amount / total;
    const dash = fraction * circumference;
    const circle = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${CATEGORY_COLORS[category] || '#999'}" stroke-width="16" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"></circle>`;
    offset += dash;
    return circle;
  }).join('');

  const legend = Object.entries(categoryTotals).map(([category, amount]) => `
    <div style="display:flex;align-items:center;gap:0.4rem;font-size:12px;margin-bottom:0.3rem">
      <span style="width:10px;height:10px;border-radius:50%;background:${CATEGORY_COLORS[category] || '#999'};display:inline-block"></span>
      ${category} · ${Number(amount).toLocaleString()}원
    </div>`).join('');

  return `
    <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem">
      <svg viewBox="0 0 100 100" width="140" height="140">${circles}</svg>
      <div>${legend}</div>
    </div>`;
}

function renderComparisonBars(currentAverages, groupAverages) {
  return Object.keys(currentAverages).map((category) => {
    const current = currentAverages[category];
    const group = groupAverages[category];
    if (group == null) return '';
    const pct = Math.round(((current - group) / group) * 100);
    const sign = pct >= 0 ? '+' : '';
    const cls = pct >= 0 ? 'pay' : 'receive';
    return `
      <div style="margin-bottom:0.6rem">
        <span class="label">${category}</span>
        <p style="font-size:13px">1인 ${Number(current).toLocaleString()}원 · 그룹 평균 대비
          <strong style="color:var(--${cls})">${sign}${pct}%</strong>
        </p>
      </div>`;
  }).join('');
}

function renderPayerSummary(perMember) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div style="background:var(--paper);padding:1rem">
          <p class="label">${escapeHtml(m.name)}</p>
          <p class="mono" style="font-family:var(--f-display);font-size:1.3rem;font-weight:700">${m.paid.toLocaleString()}</p>
        </div>`).join('')}
    </div>`;
}

function renderSettlement(perMember, isAdmin) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div style="background:var(--paper);padding:1rem">
          <p style="font-family:var(--f-kr);font-weight:500">${escapeHtml(m.name)}
            ${m.settled ? '<span class="badge badge-locked" style="margin-left:0.4rem">입금완료</span>' : ''}</p>
          <p class="muted" style="font-size:12px">내야 할 금액 ${m.due.toLocaleString()}원 · 실제 지출 ${m.paid.toLocaleString()}원</p>
          <p class="mono" style="font-family:var(--f-display);font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
          ${m.account ? `<p class="muted" style="font-size:12px">계좌 ${escapeHtml(m.account)}</p>` : ''}
          ${isAdmin ? `<button type="button" class="btn btn-secondary settle-toggle" data-id="${m.id}" data-settled="${m.settled}" style="margin-top:0.4rem">${m.settled ? '입금완료 해제' : '입금완료 표시'}</button>` : ''}
        </div>`).join('')}
    </div>`;
}

export { mount, renderReportInto };
