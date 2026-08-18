(() => {
  const SORT_KEY = 'todo:lastSort';
  let drag = null;

  function ensureManualSortOption() {
    const sort = $('#sort');
    if (!sort) return;
    if (!sort.querySelector('option[value="manual"]')) {
      const option = document.createElement('option');
      option.value = 'manual';
      option.textContent = '사용자 지정순';
      sort.insertBefore(option, sort.firstChild);
    }
  }

  function manualFiltered() {
    let a = base();
    const q = $('#search').value.trim().toLowerCase();
    const f = $('#filterStatus').value;

    if (q) {
      a = a.filter(t => (t.title + ' ' + (t.memo || '') + ' ' + pName(t.projectId)).toLowerCase().includes(q));
    }
    if (f === 'overdue') {
      a = a.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today());
    } else if (f !== 'all') {
      a = a.filter(t => t.status === f);
    }
    return a;
  }

  const previousFiltered = filtered;
  filtered = function() {
    if ($('#sort')?.value === 'manual') return manualFiltered();
    return previousFiltered();
  };

  function makeHandle() {
    const handle = document.createElement('span');
    handle.className = 'task-drag-handle';
    handle.textContent = '↕';
    handle.title = '잡고 끌어서 할 일 순서 변경';
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', '할 일 순서 변경');
    handle.setAttribute('tabindex', '0');
    return handle;
  }

  function addDragHandles() {
    document.querySelectorAll('#taskBody tr[data-id]').forEach(row => {
      if (row.querySelector('.task-drag-handle')) return;
      const cell = row.lastElementChild;
      if (!cell || cell.classList.contains('mobile-task-cell')) return;
      cell.querySelectorAll('.order-controls').forEach(x => x.remove());
      cell.insertBefore(makeHandle(), cell.firstChild);
    });
  }

  function installOrderStyles() {
    if (document.getElementById('manualOrderStyle')) return;
    const style = document.createElement('style');
    style.id = 'manualOrderStyle';
    style.textContent = `
      .task-drag-handle{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:28px;
        height:28px;
        margin-right:5px;
        border:1px solid #dfe5ed;
        border-radius:8px;
        background:#f7f9fc;
        color:#758196;
        font-size:15px;
        font-weight:800;
        line-height:1;
        vertical-align:middle;
        cursor:grab;
        touch-action:none;
        user-select:none;
        -webkit-user-select:none;
        box-sizing:border-box;
      }
      .task-drag-handle:active{cursor:grabbing;}
      #taskBody tr.task-row-dragging{
        opacity:.72;
        outline:2px solid rgba(47,111,237,.38);
        outline-offset:-2px;
      }
      #taskBody tr.task-row-dragging .mobile-task-card{
        background:#f5f8ff;
      }
      body.task-reordering{
        user-select:none;
        -webkit-user-select:none;
      }
      @media(max-width:600px){
        .task-drag-handle{
          width:38px!important;
          height:32px!important;
          margin:0!important;
          border-radius:9px!important;
          font-size:17px!important;
          flex:0 0 38px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function visibleRows() {
    return [...document.querySelectorAll('#taskBody tr[data-id]')];
  }

  function reorderStateToDom() {
    const ids = visibleRows().map(row => String(row.dataset.id));
    if (!ids.length) return false;

    const visibleSet = new Set(ids);
    const slots = [];
    const byId = new Map(state.tasks.map(t => [String(t.id), t]));
    state.tasks.forEach((t, index) => {
      if (visibleSet.has(String(t.id))) slots.push(index);
    });

    if (slots.length !== ids.length || ids.some(id => !byId.has(id))) return false;
    slots.forEach((slot, index) => {
      state.tasks[slot] = byId.get(ids[index]);
    });
    return true;
  }

  function switchToManualUsingCurrentView() {
    ensureManualSortOption();
    const sort = $('#sort');
    if (!sort) return;
    if (sort.value !== 'manual') {
      reorderStateToDom();
      sort.value = 'manual';
      localStorage.setItem(SORT_KEY, 'manual');
    }
  }

  function moveRowAtPointer(clientY) {
    if (!drag?.row) return;
    const body = $('#taskBody');
    const row = drag.row;
    const others = visibleRows().filter(x => x !== row);
    if (!others.length) return;

    let before = null;
    for (const item of others) {
      const rect = item.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        before = item;
        break;
      }
    }

    if (before) {
      if (row.nextElementSibling !== before) body.insertBefore(row, before);
    } else if (body.lastElementChild !== row) {
      body.appendChild(row);
    }
  }

  function autoScroll(clientY) {
    const edge = 72;
    const step = 14;
    if (clientY < edge) window.scrollBy(0, -step);
    else if (clientY > window.innerHeight - edge) window.scrollBy(0, step);
  }

  function finishDrag(saveOrder) {
    if (!drag) return;
    const moved = drag.dragging;
    drag.row?.classList.remove('task-row-dragging');
    drag = null;
    document.body.classList.remove('task-reordering');

    if (moved && saveOrder) {
      reorderStateToDom();
      save();
      render();
    }
  }

  function bindDragEvents() {
    const body = $('#taskBody');
    if (!body || body.dataset.taskDragBound === '1') return;
    body.dataset.taskDragBound = '1';

    body.addEventListener('click', e => {
      if (e.target.closest('.task-drag-handle')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    body.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.task-drag-handle');
      if (!handle) return;
      const row = handle.closest('tr[data-id]');
      if (!row) return;

      e.preventDefault();
      e.stopPropagation();
      drag = {
        pointerId: e.pointerId,
        row,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false
      };
      try { handle.setPointerCapture(e.pointerId); } catch {}
    });

    window.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.dragging && Math.hypot(dx, dy) < 7) return;

      if (!drag.dragging) {
        switchToManualUsingCurrentView();
        drag.dragging = true;
        drag.row.classList.add('task-row-dragging');
        document.body.classList.add('task-reordering');
      }

      e.preventDefault();
      autoScroll(e.clientY);
      moveRowAtPointer(e.clientY);
    }, {passive:false});

    window.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      finishDrag(true);
    });

    window.addEventListener('pointercancel', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      finishDrag(true);
    });
  }

  const previousRenderTasks = renderTasks;
  renderTasks = function() {
    previousRenderTasks();
    addDragHandles();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    ensureManualSortOption();
    addDragHandles();
    bindDragEvents();
  };

  ensureManualSortOption();
  installOrderStyles();
  bindDragEvents();

  const sort = $('#sort');
  const savedSort = localStorage.getItem(SORT_KEY);
  if (savedSort && [...sort.options].some(o => o.value === savedSort)) {
    sort.value = savedSort;
  }

  sort.onchange = () => {
    localStorage.setItem(SORT_KEY, sort.value);
    renderTasks();
  };

  $('#taskBody').onclick = e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    const t = state.tasks.find(x => x.id === id);
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

  render();
})();
