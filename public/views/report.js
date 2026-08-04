import { callFunction } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, escapeHtml } from '../ui.js';
import { formatDate } from '../format.js';
import { categoryTag } from '../categories.js';
import { renderTripPhotosInto } from './tripPhotos.js';
import { renderDonutChart, renderCategoryComparison, renderComparisonDetail } from '../charts.js';
import { buildWaypoints, renderRouteMap } from '../routeMap.js';

async function renderReportInto(container, slug) {
  const session = getSession();
  container.innerHTML = '<p class="muted">불러오는 중...</p>';

  let data, scheduleData;
  try {
    // Two calls rather than extending getReportData: that function carries the
    // settlement maths and a thick test suite, and a visualisation is no reason
    // to change its shape. Promise.all keeps it to one round trip of latency.
    // listSchedules fails soft: the route map is a decorative section, and the
    // money (settlement, category analysis, per-payer, final split) is the
    // report's primary output and must not go dark because of it. It also
    // isn't a pure read -- it calls ensureDefaultPlan, which writes plans/default
    // when absent -- so it has a strictly larger failure surface than the read
    // beside it and deserves a softer landing.
    [data, scheduleData] = await Promise.all([
      callFunction('getReportData', { tripId: session.tripId }),
      callFunction('listSchedules', { tripId: session.tripId }).catch(() => ({ schedules: [] })),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="muted">리포트를 불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="report-retry">다시 시도</button>`;
    const rb = container.querySelector('#report-retry');
    if (rb) rb.addEventListener('click', () => renderReportInto(container, slug));
    return;
  }
  const {
    trip, members, expenses, settlement,
    tripDays, currentCategoryPerDay, groupCategoryPerDayAverages, tripsInComparison,
  } = data;
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
      ${renderComparisonSection(tripDays, currentCategoryPerDay, groupCategoryPerDayAverages, tripsInComparison)}
    </div>
    <div class="section"><h2>결제자별 지출</h2>${renderPayerSummary(settlement.perMember)}</div>
    <div class="section"><h2>정산 요약</h2>
      <p>총 확정 지출 <strong class="mono">${settlement.totalConfirmed.toLocaleString()}원</strong></p>
      <p class="muted" style="font-size:13px">확정 지출을 제외되지 않은 구성원끼리 가중치 비율로 나눠 각자 '내야 할 금액'을 구하고, 실제 결제액과 비교해 차액(받을 돈/낼 돈)을 계산합니다. 아래 최종 정산에서 구성원 카드를 누르면 계산 내역을 볼 수 있습니다.</p>
    </div>
    <div class="section"><h2>최종 정산</h2>${renderSettlement(settlement.perMember, session.role === 'admin')}</div>
    <div class="section"><h2>여행 경로</h2>
      ${renderRouteMap(buildWaypoints(scheduleData.schedules, expenses), { location: trip.location, period: trip.period })}
    </div>
    <div class="section"><h2>여행사진</h2><div id="report-photos"></div></div>`;

  container.querySelectorAll('.report-receipt-row').forEach((row) => {
    row.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: row.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증">`);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  container.querySelectorAll('.settle-toggle').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const next = btn.dataset.settled !== 'true';
      btn.disabled = true;
      try {
        await callFunction('setMemberSettled', { tripId: session.tripId, memberId: btn.dataset.id, settled: next });
        const card = btn.closest('[data-member-id]');
        card.querySelector('.settle-badge').innerHTML = next ? '<span class="badge badge-locked" style="margin-left:0.4rem">입금완료</span>' : '';
        btn.dataset.settled = String(next);
        btn.textContent = next ? '입금완료 해제' : '입금완료 표시';
        btn.disabled = false;
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });

  // Both the numerator and the headcount come from the settlement the server
  // already computed, so the modal's arithmetic cannot drift from the table's.
  const dueHeadcount = settlement.perMember.filter((m) => m.due > 0).length;
  container.querySelectorAll('.cmp-row').forEach((row) => {
    row.addEventListener('click', (ev) => {
      const category = row.dataset.category;
      const cell = ev.target.closest('[data-field]');
      openModal(`${category} 산출 근거`, renderComparisonDetail({
        category,
        categoryTotal: settlement.categoryTotals[category] ?? 0,
        headcount: dueHeadcount,
        tripDays,
        currentPerDay: currentCategoryPerDay[category],
        groupPerDay: groupCategoryPerDayAverages[category],
        tripsInComparison,
        focus: cell ? cell.dataset.field : null,
      }));
    });
  });

  container.querySelectorAll('.settle-card').forEach((card) => {
    card.addEventListener('click', () => {
      const m = settlement.perMember.find((x) => x.id === card.dataset.memberId);
      if (!m) return;
      const isOwn = session.memberId === m.id;
      openModal(`${m.name} 정산 상세`, renderSettlementDetail(m, isOwn));
      if (!isOwn) return;
      const saveBtn = document.getElementById('sd-account-save');
      const input = document.getElementById('sd-account');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
        try {
          const account = input.value;
          await callFunction('setMyAccount', { tripId: session.tripId, account });
          m.account = account.trim() || null;
          const line = card.querySelector('.settle-account');
          if (line) {
            line.textContent = m.account ? `계좌 ${m.account}` : '';
            line.style.display = m.account ? '' : 'none';
          }
          closeModal();
          showToast('계좌가 저장되었습니다', 'success');
        } catch (err) {
          saveBtn.disabled = false; saveBtn.textContent = '계좌 저장';
          document.getElementById('sd-account-error').textContent = err.message;
        }
      });
    });
  });

  await renderTripPhotosInto(container.querySelector('#report-photos'), session.tripId);
}

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) { location.href = `/t/${slug}`; return; }
  const backHref = session.role === 'admin' ? `/t/${slug}/admin` : `/t/${slug}`;
  root.innerHTML = `<div class="container" style="padding-top:2rem">
      <p class="label"><a href="/" style="text-decoration:none;color:inherit">← TripSplit</a></p>
      <p class="center"><a href="${backHref}">← 돌아가기</a></p>
      <div id="report-body"></div>
    </div>`;
  renderReportInto(document.getElementById('report-body'), slug);
}

function renderExpenseTable(expenses, nameById) {
  return `
    <div style="overflow-x:auto">
    <table class="expense-table">
      <thead><tr>
        <th class="col-date">날짜</th><th>카테고리</th><th>내용</th>
        <th class="col-payer">결제자</th><th class="col-amount">금액</th>
      </tr></thead>
      <tbody>
        ${expenses.map((e) => `
          <tr${e.photoPath ? ' class="report-receipt-row" style="cursor:pointer" data-id="' + e.id + '"' : ''}>
            <td class="col-date">${escapeHtml(formatDate(e.date))}</td>
            <td>${categoryTag(e.category)}</td>
            <td class="col-desc">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}
              ${e.excludedMembers && e.excludedMembers.length ? `<span class="muted" style="font-size:11px">· 제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</span>` : ''}
              ${e.photoPath ? '<span class="muted" style="font-size:11px">· 📷</span>' : ''}
            </td>
            <td class="col-payer">${escapeHtml(nameById[e.enteredBy] || '?')}</td>
            <td class="col-amount mono">${Number(e.amount).toLocaleString()}원</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderComparisonSection(tripDays, currentPerDay, groupPerDay, tripsInComparison) {
  if (!tripDays) return '<p class="muted">여행 기간이 설정되지 않아 하루 기준 비교를 계산할 수 없습니다.</p>';
  if (tripsInComparison === 0) return '<p class="muted">비교할 과거 여행이 아직 없습니다.</p>';
  return renderCategoryComparison(currentPerDay, groupPerDay, tripDays, tripsInComparison);
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

function renderSettlementDetail(m, isOwn) {
  const rows = (m.breakdown || []).map((b) => `
    <tr style="border-top:1px solid var(--rule)">
      <td style="padding:0.4rem">${categoryTag(b.category)}</td>
      <td>${escapeHtml(b.merchant || '')}</td>
      <td style="text-align:right" class="mono">${b.share.toLocaleString()}원</td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)"><th style="padding:0.4rem">카테고리</th><th>상호</th><th style="text-align:right">내 분담액</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted" style="padding:0.6rem">포함된 확정 지출이 없습니다.</td></tr>'}</tbody>
    </table></div>
    <p style="margin-top:0.8rem">내야 할 금액 <strong class="mono">${m.due.toLocaleString()}원</strong> · 실제 결제 <span class="mono">${m.paid.toLocaleString()}원</span></p>
    <p class="mono" style="font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">차액 ${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
    ${m.account ? `<p class="muted" style="font-size:12px">계좌 ${escapeHtml(m.account)}</p>` : ''}
    ${isOwn ? `
      <div class="field" style="margin-top:0.8rem"><label class="label">내 계좌 입력/수정</label>
        <input class="input" id="sd-account" value="${escapeHtml(m.account || '')}" placeholder="예: 우리 1002-123-456789"></div>
      <button type="button" class="btn btn-primary btn-block" id="sd-account-save">계좌 저장</button>
      <p class="muted" id="sd-account-error" style="margin-top:0.5rem;font-size:13px"></p>` : ''}`;
}

function renderSettlement(perMember, isAdmin) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div class="card settle-card" style="background:var(--paper);padding:1rem;cursor:pointer" data-member-id="${m.id}">
          <p style="font-family:var(--f-kr);font-weight:500">${escapeHtml(m.name)}
            <span class="settle-badge">${m.settled ? '<span class="badge badge-locked" style="margin-left:0.4rem">입금완료</span>' : ''}</span></p>
          <p class="muted" style="font-size:12px">내야 할 금액 ${m.due.toLocaleString()}원 · 실제 지출 ${m.paid.toLocaleString()}원</p>
          <p class="mono" style="font-family:var(--f-display);font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
          <p class="muted settle-account" style="font-size:12px${m.account ? '' : ';display:none'}">${m.account ? '계좌 ' + escapeHtml(m.account) : ''}</p>
          ${isAdmin ? `<button type="button" class="btn btn-secondary settle-toggle" data-id="${m.id}" data-settled="${m.settled}" style="margin-top:0.4rem">${m.settled ? '입금완료 해제' : '입금완료 표시'}</button>` : ''}
        </div>`).join('')}
    </div>`;
}

export { mount, renderReportInto };
