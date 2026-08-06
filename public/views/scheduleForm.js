import { callFunction } from '../api.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml } from '../ui.js';
import { CATEGORIES, categoryMark } from '../categories.js';
import { minToLabel, labelToMin, mapLinkFor } from '../scheduleLayout.js';

/**
 * Schedule add/edit modal.
 *
 * schedule === null means add, an object means edit. On add, all members are
 * checked as participants by default — an empty array is never used to mean
 * "everyone"; the full member list is always saved explicitly.
 */
function openScheduleForm({
  tripId, members, schedule, defaultDate, onSaved,
}) {
  const isEdit = !!schedule;
  let category = isEdit ? schedule.category : CATEGORIES[1];
  // why: schedule.participants may contain ids of members removed since the
  // schedule was saved. Filtering through the live member list keeps those
  // stale ids out of `selected` entirely, so they can't be silently
  // re-submitted and rejected by assertMemberIdsExist on save.
  const selected = new Set(
    isEdit ? schedule.participants?.filter((id) => members.some((m) => m.id === id)) || [] : members.map((m) => m.id),
  );

  const noDate = isEdit && !schedule.date;
  const noTime = isEdit && schedule.startMin === null;

  openModal(isEdit ? '일정 수정' : '일정 추가', `
    <div class="field"><label class="label">카테고리</label><div id="sf-category"></div></div>
    <div class="field">
      <label class="label">날짜</label>
      <input type="date" class="input" id="sf-date"
             value="${escapeHtml(isEdit ? (schedule.date || '') : (defaultDate || ''))}"
             ${noDate ? 'disabled' : ''}>
      <label class="check-inline">
        <input type="checkbox" id="sf-nodate" ${noDate ? 'checked' : ''}> 날짜 미정
      </label>
    </div>
    <div class="field">
      <label class="label">시간</label>
      <div class="sf-time-row">
        <input type="time" step="900" class="input" id="sf-start"
               value="${escapeHtml(isEdit ? minToLabel(schedule.startMin) : '')}" ${noTime ? 'disabled' : ''}>
        <span class="muted">–</span>
        <input type="time" step="900" class="input" id="sf-end"
               value="${escapeHtml(isEdit ? minToLabel(schedule.endMin) : '')}" ${noTime ? 'disabled' : ''}>
      </div>
      <label class="check-inline">
        <input type="checkbox" id="sf-notime" ${noTime ? 'checked' : ''}> 시간 미정
      </label>
    </div>
    <div class="field"><label class="label">내용</label>
      <input class="input" id="sf-title" value="${escapeHtml(isEdit ? schedule.title : '')}"></div>
    <div class="field"><label class="label">세부</label>
      <input class="input" id="sf-detail" value="${escapeHtml(isEdit ? (schedule.detail || '') : '')}"></div>
    <div class="field"><label class="label">위치</label>
      <input class="input" id="sf-place" placeholder="장소명 또는 지도 링크"
             value="${escapeHtml(isEdit ? (schedule.placeName || '') : '')}">
      <div id="sf-place-link" class="muted" style="font-size:12px;margin-top:0.3rem"></div>
    </div>
    <div class="field"><label class="label">참여자</label><div id="sf-participants"></div></div>
    <button type="button" class="btn btn-primary btn-block" id="sf-submit">저장</button>
    ${isEdit ? '<button type="button" class="btn btn-secondary btn-block" id="sf-delete" style="margin-top:0.5rem">삭제</button>' : ''}
    <p class="muted" id="sf-error" style="margin-top:0.5rem;font-size:13px"></p>
    ${isEdit ? `<p class="muted" style="margin-top:0.5rem;font-size:12px">마지막 수정: ${escapeHtml(lastEditorName(schedule, members))}</p>` : ''}
  `);

  function rerenderCategory() {
    renderChipGroup(document.getElementById('sf-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategory();
    }, { dotColor: categoryMark });
  }
  rerenderCategory();

  function renderParticipants() {
    const all = members.length > 0 && members.every((m) => selected.has(m.id));
    document.getElementById('sf-participants').innerHTML = `
      <label class="check-inline"><input type="checkbox" id="sf-all" ${all ? 'checked' : ''}> <strong>전체</strong></label>
      ${members.map((m) => `
        <label class="check-inline">
          <input type="checkbox" class="sf-p" data-id="${escapeHtml(m.id)}" ${selected.has(m.id) ? 'checked' : ''}>
          ${escapeHtml(m.name)}
        </label>`).join('')}`;

    document.getElementById('sf-all').addEventListener('change', (ev) => {
      selected.clear();
      if (ev.target.checked) members.forEach((m) => selected.add(m.id));
      renderParticipants();
    });
    document.querySelectorAll('.sf-p').forEach((box) => {
      box.addEventListener('change', () => {
        if (box.checked) selected.add(box.dataset.id);
        else selected.delete(box.dataset.id);
        renderParticipants();
      });
    });
  }
  renderParticipants();

  function refreshPlaceLink() {
    const link = mapLinkFor(document.getElementById('sf-place').value);
    document.getElementById('sf-place-link').innerHTML = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">카카오맵에서 열기 ↗</a>`
      : '';
  }
  document.getElementById('sf-place').addEventListener('input', refreshPlaceLink);
  refreshPlaceLink();

  document.getElementById('sf-nodate').addEventListener('change', (ev) => {
    document.getElementById('sf-date').disabled = ev.target.checked;
    // A date-less schedule cannot carry a time either — the backend rejects that.
    if (ev.target.checked) {
      const notime = document.getElementById('sf-notime');
      notime.checked = true;
      notime.dispatchEvent(new Event('change'));
    }
  });

  document.getElementById('sf-notime').addEventListener('change', (ev) => {
    document.getElementById('sf-start').disabled = ev.target.checked;
    document.getElementById('sf-end').disabled = ev.target.checked;
  });

  document.getElementById('sf-submit').addEventListener('click', async () => {
    const btn = document.getElementById('sf-submit');
    const err = document.getElementById('sf-error');
    btn.disabled = true; btn.textContent = '저장 중...';

    const dateOff = document.getElementById('sf-nodate').checked;
    const timeOff = document.getElementById('sf-notime').checked;
    const payload = {
      tripId,
      planId: 'default',
      title: document.getElementById('sf-title').value,
      detail: document.getElementById('sf-detail').value,
      placeName: document.getElementById('sf-place').value,
      category,
      date: dateOff ? null : (document.getElementById('sf-date').value || null),
      startMin: timeOff ? null : labelToMin(document.getElementById('sf-start').value),
      endMin: timeOff ? null : labelToMin(document.getElementById('sf-end').value),
      participants: [...selected],
    };

    try {
      if (isEdit) {
        const { tripId: _t, planId: _p, ...patch } = payload;
        await callFunction('updateSchedule', { tripId, scheduleId: schedule.id, patch });
      } else {
        await callFunction('addSchedule', payload);
      }
      closeModal();
      onSaved();
    } catch (e) {
      btn.disabled = false; btn.textContent = '저장';
      err.textContent = e.message;
    }
  });

  if (isEdit) {
    document.getElementById('sf-delete').addEventListener('click', async () => {
      if (!window.confirm(`'${schedule.title}' 일정을 삭제할까요?`)) return;
      const btn = document.getElementById('sf-delete');
      btn.disabled = true; btn.textContent = '삭제 중...';
      try {
        await callFunction('deleteSchedule', { tripId, scheduleId: schedule.id });
        closeModal();
        onSaved();
      } catch (e) {
        btn.disabled = false; btn.textContent = '삭제';
        showToast(e.message, 'error');
      }
    });
  }
}

function lastEditorName(schedule, members) {
  if (schedule.updatedByRole === 'admin') return '관리자';
  const found = members.find((m) => m.id === schedule.updatedBy);
  return found ? found.name : '알 수 없음';
}

export { openScheduleForm };
