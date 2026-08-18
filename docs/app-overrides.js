(() => {
  const LAST_DUE_KEY = 'todo:lastDue';

  function normalizeStatuses() {
    let changed = false;
    if (!state || !Array.isArray(state.tasks)) return false;
    state.tasks.forEach(t => {
      if (!['doing','wait','done'].includes(t.status)) {
        t.status = 'doing';
        changed = true;
      }
    });
    return changed;
  }

  // 상태 표시: 진행중 / 대기 / 완료만 사용
  statusLabel = s => ({doing:'진행중', wait:'대기', done:'완료'}[s] || '진행중');

  // 기존 저장 데이터에 todo 상태가 있으면 진행중으로 자동 변환
  const originalEnter = enter;
  enter = async function() {
    await originalEnter();
    const changed = normalizeStatuses();
    restoreLastDue();
    if (changed) save();
    render();
  };

  const originalImportData = importData;
  importData = async function(file) {
    await originalImportData(file);
    if (normalizeStatuses()) save();
    render();
  };

  // 프로젝트순 정렬 추가
  filtered = function() {
    let a = base();
    const q = $('#search').value.trim().toLowerCase();
    const f = $('#filterStatus').value;
    const s = $('#sort').value;

    if (q) a = a.filter(t => (t.title+' '+(t.memo||'')+' '+pName(t.projectId)).toLowerCase().includes(q));
    if (f === 'overdue') a = a.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today());
    else if (f !== 'all') a = a.filter(t => t.status === f);

    const pr = {high:0, mid:1, low:2};
    const sr = {doing:0, wait:1, done:2};
    const due = (x,y) => !x.dueDate && !y.dueDate
      ? (y.createdAt||0) - (x.createdAt||0)
      : !x.dueDate ? 1
      : !y.dueDate ? -1
      : x.dueDate.localeCompare(y.dueDate);

    a.sort((x,y) => {
      if (s === 'created-desc') return (y.createdDate||'').localeCompare(x.createdDate||'');
      if (s === 'created-asc') return (x.createdDate||'').localeCompare(y.createdDate||'');
      if (s === 'priority') return pr[x.priority] - pr[y.priority] || due(x,y);
      if (s === 'status') return (sr[x.status] ?? 9) - (sr[y.status] ?? 9) || due(x,y);
      if (s === 'project') return pName(x.projectId).localeCompare(pName(y.projectId), 'ko') || due(x,y);
      return due(x,y);
    });
    return a;
  };

  function restoreLastDue() {
    const input = $('#newDueDate');
    if (!input) return;
    const saved = localStorage.getItem(LAST_DUE_KEY);
    if (saved !== null) input.value = saved;
    $('#newDuePreview').textContent = duePreview(input.value);
  }

  // 새 할 일 추가: 기본 상태는 진행중, 마감일은 마지막 선택값 유지
  addTask = function() {
    const title = $('#newTitle').value.trim();
    if (!title) return $('#newTitle').focus();

    const dueDate = $('#newDueDate').value;
    localStorage.setItem(LAST_DUE_KEY, dueDate);

    state.tasks.unshift({
      id: uid(),
      title,
      projectId: $('#newProject').value,
      status: $('#newStatus').value || 'doing',
      priority: $('#newPriority').value,
      createdDate: $('#newCreatedDate').value || today(),
      dueDate,
      memo:'',
      createdAt:Date.now()
    });

    $('#newTitle').value = '';
    $('#newStatus').value = 'doing';
    $('#newPriority').value = 'mid';
    $('#newCreatedDate').value = today();
    // 마감일은 지우지 않음
    $('#newDueDate').value = dueDate;
    $('#newDuePreview').textContent = duePreview(dueDate);
    save();
    render();
    $('#newTitle').focus();
  };

  function applyStatusUI() {
    const newStatus = $('#newStatus');
    const editStatus = $('#editStatus');
    const filter = $('#filterStatus');
    const sort = $('#sort');

    if (newStatus) {
      newStatus.innerHTML = '<option value="doing">진행중</option><option value="wait">대기</option><option value="done">완료</option>';
      newStatus.value = 'doing';
    }
    if (editStatus) {
      editStatus.innerHTML = '<option value="doing">진행중</option><option value="wait">대기</option><option value="done">완료</option>';
    }
    if (filter) {
      const current = filter.value;
      filter.innerHTML = '<option value="all">상태 전체</option><option value="doing">진행중</option><option value="wait">대기</option><option value="done">완료</option><option value="overdue">기한 초과</option>';
      filter.value = ['all','doing','wait','done','overdue'].includes(current) ? current : 'all';
    }
    if (sort && !sort.querySelector('option[value="project"]')) {
      const option = document.createElement('option');
      option.value = 'project';
      option.textContent = '프로젝트순';
      sort.appendChild(option);
    }
  }

  applyStatusUI();
  restoreLastDue();

  // 기존 핸들러를 새 동작으로 교체
  $('#addBtn').onclick = addTask;
  $('#newTitle').onkeydown = e => { if (e.key === 'Enter') addTask(); };
  $('#newDueDate').oninput = e => {
    localStorage.setItem(LAST_DUE_KEY, e.target.value);
    $('#newDuePreview').textContent = duePreview(e.target.value);
  };

  // 완료 체크를 해제하면 '진행중'으로 복귀
  $('#taskBody').onclick = e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;

    if (e.target.classList.contains('check')) {
      t.status = e.target.checked ? 'done' : 'doing';
      save();
      render();
    } else if (e.target.classList.contains('edit')) {
      openEdit(id);
    } else if (e.target.classList.contains('delete')) {
      delTask(id);
    }
  };

  // 이미 로드된 로컬 상태도 즉시 정리
  if (normalizeStatuses()) save();
})();