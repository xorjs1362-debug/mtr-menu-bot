(() => {
  const LAST_DUE_KEY = 'todo:lastDue';
  const DESKTOP_WIDTHS = [58,314,140,113,107,125,168,150,155];
  const MOBILE_WIDTHS = [44,168,100,90,82,100,148,128,118];

  function formatCompletedAt(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const pad = n => String(n).padStart(2,'0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
    };
  }

  function completedHtml(value) {
    const x = formatCompletedAt(value);
    if (!x) return '-';
    return `<span class="completed-date">${esc(x.date)}</span><span class="completed-time">${esc(x.time)}</span>`;
  }

  function ensureCompletedHeader() {
    const row = document.querySelector('.table-wrap thead tr');
    if (!row || row.querySelector('[data-completed-header]')) return;
    const th = document.createElement('th');
    th.dataset.completedHeader = '1';
    th.textContent = '완료일시';
    row.insertBefore(th, row.lastElementChild);
  }

  function applyCompletionLayout() {
    ensureCompletedHeader();
    const table = document.querySelector('.table-wrap table');
    if (!table) return;

    const widths = window.matchMedia('(max-width:600px)').matches ? MOBILE_WIDTHS : DESKTOP_WIDTHS;
    const total = widths.reduce((a,b)=>a+b,0);
    table.style.tableLayout = 'fixed';
    table.style.width = total + 'px';
    table.style.minWidth = total + 'px';
    table.style.maxWidth = total + 'px';

    table.querySelectorAll('colgroup[data-layout]').forEach(x=>x.remove());
    const colgroup = document.createElement('colgroup');
    colgroup.dataset.layout = 'completion-v17';
    widths.forEach(w => {
      const col = document.createElement('col');
      col.style.width = w + 'px';
      col.style.minWidth = w + 'px';
      col.style.maxWidth = w + 'px';
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);

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

  function installStyles() {
    if (document.getElementById('completionTrackingStyle')) return;
    const style = document.createElement('style');
    style.id = 'completionTrackingStyle';
    style.textContent = `
      .completed-at-cell{white-space:nowrap;font-size:11px;line-height:1.35;}
      .completed-time::before{content:' ';}
      td:nth-child(9) button{padding:5px 6px;font-size:10px;}
      @media(max-width:600px){
        .completed-at-cell{font-size:10px;white-space:normal;}
        .completed-date,.completed-time{display:block;}
        .completed-time::before{content:'';}
        td:nth-child(9) button{padding:4px 5px;font-size:10px;}
      }
    `;
    document.head.appendChild(style);
  }

  renderTasks = function() {
    const a = filtered();
    $('#taskBody').innerHTML = a.map(t=>{
      const overdue = t.status !== 'done' && t.dueDate && t.dueDate < today();
      return `<tr data-id="${esc(t.id)}" class="${t.status==='done'?'done':''} ${overdue?'overdue':''}">
        <td><input class="check" type="checkbox" ${t.status==='done'?'checked':''}></td>
        <td><b>${esc(t.title)}</b>${t.memo?`<small class="memo">${esc(t.memo)}</small>`:''}</td>
        <td><span class="tag">${esc(pName(t.projectId))}</span></td>
        <td><span class="tag s-${t.status}">${statusLabel(t.status)}</span></td>
        <td><span class="tag p-${t.priority}">${priorityLabel(t.priority)}</span></td>
        <td>${esc(t.createdDate||'-')}</td>
        <td class="${overdue?'late':''}">${esc(t.dueDate||'-')} ${t.dueDate?`<span class="dday">${dday(t.dueDate)}</span>`:''}</td>
        <td class="completed-at-cell">${completedHtml(t.completedAt)}</td>
        <td><button class="edit">수정</button> <button class="delete danger">삭제</button></td>
      </tr>`;
    }).join('');
    $('#emptyState').hidden = a.length !== 0;
    $('#visibleInfo').textContent = `${a.length}개 표시`;
    applyCompletionLayout();
  };

  addTask = function() {
    const title = $('#newTitle').value.trim();
    if (!title) return $('#newTitle').focus();

    const dueDate = $('#newDueDate').value;
    const status = $('#newStatus').value || 'doing';
    localStorage.setItem(LAST_DUE_KEY, dueDate);

    state.tasks.unshift({
      id: uid(),
      title,
      projectId: $('#newProject').value,
      status,
      priority: $('#newPriority').value,
      createdDate: $('#newCreatedDate').value || today(),
      dueDate,
      memo: '',
      createdAt: Date.now(),
      completedAt: status === 'done' ? Date.now() : null
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

  saveEdit = function() {
    const t = state.tasks.find(x=>x.id===editing);
    const title = $('#editTitle').value.trim();
    if (!t || !title) return;

    const previousStatus = t.status;
    const nextStatus = $('#editStatus').value;
    let completedAt = t.completedAt || null;
    if (nextStatus === 'done' && previousStatus !== 'done') completedAt = Date.now();
    if (nextStatus !== 'done') completedAt = null;

    Object.assign(t,{
      title,
      projectId: $('#editProject').value,
      status: nextStatus,
      priority: $('#editPriority').value,
      createdDate: $('#editCreatedDate').value || today(),
      dueDate: $('#editDueDate').value,
      memo: $('#editMemo').value.trim(),
      completedAt
    });
    save();
    closeEdit();
    render();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    ensureCompletedHeader();
    applyCompletionLayout();
  };

  installStyles();
  ensureCompletedHeader();

  $('#addBtn').onclick = addTask;
  $('#newTitle').onkeydown = e => { if (e.key === 'Enter') addTask(); };
  $('#editSaveBtn').onclick = saveEdit;
  $('#search').oninput = renderTasks;
  $('#filterStatus').onchange = renderTasks;
  $('#sort').onchange = renderTasks;

  $('#taskBody').onclick = e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    const t = state.tasks.find(x=>x.id===id);
    if (!t) return;

    if (e.target.classList.contains('check')) {
      if (e.target.checked) {
        t.status = 'done';
        t.completedAt = Date.now();
      } else {
        t.status = 'doing';
        t.completedAt = null;
      }
      save();
      render();
    } else if (e.target.classList.contains('edit')) {
      openEdit(id);
    } else if (e.target.classList.contains('delete')) {
      delTask(id);
    }
  };

  window.addEventListener('resize', applyCompletionLayout);
  render();
})();
