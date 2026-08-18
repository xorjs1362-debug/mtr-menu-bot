(() => {
  const SORT_KEY = 'todo:lastSort';
  const HOLD_MS = 2000;
  const MOVE_CANCEL_PX = 8;
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
    handle.title = '2초 이상 길게 눌러 할 일 순서 변경';
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', '2초 이상 길게 눌러 할 일 순서 변경');
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
        touch-action:auto;
        user-select:none;
        -webkit-user-select:none;
        -webkit-touch-callout:none;
        box-sizing:border-box;
        transition:background .15s,box-shadow .15s,transform .15s;
      }
      .task-drag-handle.hold-pending{
        transform:scale(.96);
        box-shadow:inset 0 0 0 2px rgba(47,111,237,.20);
      }
      .task-drag-handle.hold-active{
        cursor:grabbing;
        background:#eaf1ff;
        box-shadow:inset 0 0 0 2px rgba(47,111,237,.45);
      }
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
        overscroll-behavior:none;
      }
      @media(max-width:600px){
        .task-drag-handle{
          width:38px!important;
          height:32px!important;
          margin:0!important;
          border-radius:9px!important;
          font-size:17px!important;
          flex:0 0 38px!important;
          touch-action:auto!important;
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
    if (!drag?.row || !drag.activated) return;
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

  function clearHoldTimer() {
    if (drag?.timer) {
      clearTimeout(drag.timer);
      drag.timer = null;
    }
  }

  function activateDrag() {
    if (!drag || drag.activated) return;
    clearHoldTimer();
    drag.activated = true;
    drag.dragging = true;
    drag.handle?.classList.remove('hold-pending');
    drag.handle?.classList.add('hold-active');
    switchToManualUsingCurrentView();
    drag.row?.classList.add('task-row-dragging');
    document.body.classList.add('task-reordering');

    if (drag.kind === 'pointer') {
      try { drag.handle?.setPointerCapture(drag.pointerId); } catch {}
    }
  }

  function beginHold(data) {
    if (drag) finishDrag(false);
    drag = {...data, activated:false, dragging:false, timer:null};
    drag.handle?.classList.add('hold-pending');
    drag.timer = setTimeout(activateDrag, HOLD_MS);
  }

  function finishDrag(saveOrder) {
    if (!drag) return;
    const shouldSave = !!(saveOrder && drag.activated);
    clearHoldTimer();

    drag.handle?.classList.remove('hold-pending', 'hold-active');
    drag.row?.classList.remove('task-row-dragging');
    if (drag.kind === 'pointer') {
      try { drag.handle?.releasePointerCapture(drag.pointerId); } catch {}
    }
    drag = null;
    document.body.classList.remove('task-reordering');

    if (shouldSave) {
      reorderStateToDom();
      save();
      render();
    }
  }

  function movedTooFar(x, y) {
    if (!drag) return false;
    return Math.hypot(x - drag.startX, y - drag.startY) > MOVE_CANCEL_PX;
  }

  function touchById(list, id) {
    return Array.from(list || []).find(t => t.identifier === id) || null;
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

    body.addEventListener('contextmenu', e => {
      if (e.target.closest('.task-drag-handle')) e.preventDefault();
    });

    body.addEventListener('touchstart', e => {
      const handle = e.target.closest('.task-drag-handle');
      if (!handle || !e.changedTouches.length) return;
      const row = handle.closest('tr[data-id]');
      if (!row) return;
      const t = e.changedTouches[0];

      beginHold({
        kind:'touch',
        touchId:t.identifier,
        handle,
        row,
        startX:t.clientX,
        startY:t.clientY
      });
    }, {passive:true});

    window.addEventListener('touchmove', e => {
      if (!drag || drag.kind !== 'touch') return;
      const t = touchById(e.touches, drag.touchId);
      if (!t) return;

      if (!drag.activated) {
        if (movedTooFar(t.clientX, t.clientY)) finishDrag(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      autoScroll(t.clientY);
      moveRowAtPointer(t.clientY);
    }, {passive:false});

    window.addEventListener('touchend', e => {
      if (!drag || drag.kind !== 'touch') return;
      if (!touchById(e.changedTouches, drag.touchId)) return;
      finishDrag(true);
    }, {passive:true});

    window.addEventListener('touchcancel', e => {
      if (!drag || drag.kind !== 'touch') return;
      if (!touchById(e.changedTouches, drag.touchId)) return;
      finishDrag(false);
    }, {passive:true});

    body.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const handle = e.target.closest('.task-drag-handle');
      if (!handle) return;
      const row = handle.closest('tr[data-id]');
      if (!row) return;

      beginHold({
        kind:'pointer',
        pointerId:e.pointerId,
        handle,
        row,
        startX:e.clientX,
        startY:e.clientY
      });
    });

    window.addEventListener('pointermove', e => {
      if (!drag || drag.kind !== 'pointer' || e.pointerId !== drag.pointerId) return;

      if (!drag.activated) {
        if (movedTooFar(e.clientX, e.clientY)) finishDrag(false);
        return;
      }

      e.preventDefault();
      autoScroll(e.clientY);
      moveRowAtPointer(e.clientY);
    }, {passive:false});

    window.addEventListener('pointerup', e => {
      if (!drag || drag.kind !== 'pointer' || e.pointerId !== drag.pointerId) return;
      finishDrag(true);
    });

    window.addEventListener('pointercancel', e => {
      if (!drag || drag.kind !== 'pointer' || e.pointerId !== drag.pointerId) return;
      finishDrag(false);
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
