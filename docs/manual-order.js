(() => {
  const SORT_KEY = 'todo:lastSort';

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

  function addMoveControls() {
    const rows = [...document.querySelectorAll('#taskBody tr[data-id]')];
    rows.forEach((row, index) => {
      const cell = row.lastElementChild;
      if (!cell || cell.querySelector('.order-controls')) return;

      const controls = document.createElement('span');
      controls.className = 'order-controls';
      controls.innerHTML = `
        <button type="button" class="move-up" title="위로 이동" aria-label="위로 이동" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="move-down" title="아래로 이동" aria-label="아래로 이동" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button>
      `;
      cell.insertBefore(controls, cell.firstChild);
    });
  }

  function installOrderStyles() {
    if (document.getElementById('manualOrderStyle')) return;
    const style = document.createElement('style');
    style.id = 'manualOrderStyle';
    style.textContent = `
      .order-controls{display:inline-flex;gap:3px;margin-right:4px;vertical-align:middle;}
      .order-controls button{min-width:26px;padding:4px 5px;font-weight:800;line-height:1;}
      .order-controls button:disabled{opacity:.28;cursor:default;}
      @media(max-width:600px){
        td:nth-child(9){white-space:normal!important;}
        .order-controls{display:flex;width:100%;gap:4px;margin:0 0 4px 0;}
        .order-controls button{flex:1;min-width:0;padding:4px 3px;}
      }
    `;
    document.head.appendChild(style);
  }

  function moveVisibleTask(id, direction) {
    ensureManualSortOption();
    $('#sort').value = 'manual';
    localStorage.setItem(SORT_KEY, 'manual');

    const visible = manualFiltered();
    const current = visible.findIndex(t => t.id === id);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= visible.length) return;

    const currentId = visible[current].id;
    const targetId = visible[target].id;
    const currentGlobal = state.tasks.findIndex(t => t.id === currentId);
    const targetGlobal = state.tasks.findIndex(t => t.id === targetId);
    if (currentGlobal < 0 || targetGlobal < 0) return;

    [state.tasks[currentGlobal], state.tasks[targetGlobal]] = [state.tasks[targetGlobal], state.tasks[currentGlobal]];
    save();
    render();
  }

  const previousRenderTasks = renderTasks;
  renderTasks = function() {
    previousRenderTasks();
    addMoveControls();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    ensureManualSortOption();
    addMoveControls();
  };

  ensureManualSortOption();
  installOrderStyles();

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

    if (e.target.classList.contains('move-up')) {
      moveVisibleTask(id, -1);
    } else if (e.target.classList.contains('move-down')) {
      moveVisibleTask(id, 1);
    } else if (e.target.classList.contains('check')) {
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
