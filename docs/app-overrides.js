(() => {
  const LAST_DUE_KEY = 'todo:lastDue';
  const DESKTOP_WIDTHS = [58,314,140,113,107,125,168,155];
  const MOBILE_WIDTHS = [44,168,100,90,82,100,148,118];

  function forceColumnLayout() {
    const table = document.querySelector('.table-wrap table');
    if (!table) return;

    const mobile = window.matchMedia('(max-width:600px)').matches;
    const widths = mobile ? MOBILE_WIDTHS : DESKTOP_WIDTHS;
    const total = widths.reduce((a,b)=>a+b,0);

    table.style.tableLayout = 'fixed';
    table.style.width = total + 'px';
    table.style.minWidth = total + 'px';
    table.style.maxWidth = total + 'px';

    let colgroup = table.querySelector('colgroup[data-layout="v14"]');
    if (!colgroup) {
      table.querySelectorAll('colgroup[data-layout]').forEach(x=>x.remove());
      colgroup = document.createElement('colgroup');
      colgroup.dataset.layout = 'v14';
      widths.forEach(()=>colgroup.appendChild(document.createElement('col')));
      table.insertBefore(colgroup, table.firstChild);
    }

    [...colgroup.children].forEach((col,i)=>{
      col.style.width = widths[i] + 'px';
      col.style.minWidth = widths[i] + 'px';
      col.style.maxWidth = widths[i] + 'px';
    });

    table.querySelectorAll('tr').forEach(row=>{
      [...row.children].forEach((cell,i)=>{
        if (i >= widths.length) return;
        const w = widths[i] + 'px';
        cell.style.width = w;
        cell.style.minWidth = w;
        cell.style.maxWidth = w;
      });
    });

    table.querySelectorAll('th:nth-child(2),td:nth-child(2)').forEach(cell=>{
      cell.style.left = widths[0] + 'px';
    });
  }

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

  const originalRender = render;
  render = function() {
    originalRender();
    forceColumnLayout();
  };

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
  forceColumnLayout();
  window.addEventListener('resize', forceColumnLayout);

  $('#addBtn').onclick = addTask;
  $('#newTitle').onkeydown = e => { if (e.key === 'Enter') addTask(); };
  $('#newDueDate').oninput = e => {
    localStorage.setItem(LAST_DUE_KEY, e.target.value);
    $('#newDuePreview').textContent = duePreview(e.target.value);
  };

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

  if (normalizeStatuses()) save();
})();