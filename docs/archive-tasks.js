(() => {
  const ARCHIVE_TAB = 'archive';

  function isArchived(t){ return !!t?.archived; }
  function activeTasks(){ return (state.tasks || []).filter(t => !isArchived(t)); }
  function archivedTasks(){ return (state.tasks || []).filter(isArchived); }
  function isKnownProject(id){ return (state.projects || []).some(p => String(p.id) === String(id)); }

  base = function(){
    const tasks = state.tasks || [];
    if(active === ARCHIVE_TAB) return tasks.filter(isArchived);
    if(active === 'all') return tasks.filter(t => !isArchived(t));
    if(active === 'unclassified') {
      return tasks.filter(t => !isArchived(t) && !isKnownProject(t.projectId));
    }
    return tasks.filter(t => !isArchived(t) && String(t.projectId) === String(active));
  };

  renderTabs = function(){
    const visible = activeTasks();
    const archived = archivedTasks();
    const tabs = [
      {id:'all', name:'전체', count:visible.length},
      ...(state.projects || []).map(p => ({
        id:p.id,
        name:p.name,
        count:visible.filter(t => String(t.projectId) === String(p.id)).length
      })),
      {
        id:'unclassified',
        name:'미분류',
        count:visible.filter(t => !isKnownProject(t.projectId)).length
      },
      {id:ARCHIVE_TAB, name:'완료', count:archived.length}
    ];

    $('#tabs').innerHTML = tabs.map(p =>
      `<button class="tab ${active===p.id?'active':''}" data-tab="${esc(p.id)}">${esc(p.name)} <small>${p.count}</small></button>`
    ).join('') + `<button class="tab addtab" id="quickProject">＋ 프로젝트</button>`;
  };

  function installStyles(){
    if(document.getElementById('archiveTaskStyle')) return;
    const style = document.createElement('style');
    style.id = 'archiveTaskStyle';
    style.textContent = `
      .archive-task,.restore-task{margin-left:3px!important;}
      .archive-task{color:#2f6fed!important;}
      .restore-task{color:#23724c!important;}
      #tabs .tab[data-tab="archive"]{border-color:#dfe6f0;}
      #tabs .tab[data-tab="archive"].active{background:#eef8f2;color:#23724c;border-color:#d8eee1;}
      @media(max-width:600px){
        .mobile-task-actions .archive-task,
        .mobile-task-actions .restore-task{
          min-width:52px!important;
          margin:0!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function addArchiveButtons(){
    const inArchive = active === ARCHIVE_TAB;
    document.querySelectorAll('#taskBody tr[data-id]').forEach(row => {
      row.querySelectorAll('.archive-task,.restore-task').forEach(x => x.remove());
      const id = row.dataset.id;
      const task = (state.tasks || []).find(t => String(t.id) === String(id));
      if(!task) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = inArchive || isArchived(task) ? 'restore-task' : 'archive-task';
      button.textContent = inArchive || isArchived(task) ? '복원' : '정리';
      button.title = inArchive || isArchived(task) ? '전체/프로젝트 목록으로 복원' : '완료 탭으로 이동';

      const mobileActions = row.querySelector('.mobile-task-actions');
      if(mobileActions){
        const del = mobileActions.querySelector('.delete');
        mobileActions.insertBefore(button, del || null);
        return;
      }

      const cell = row.lastElementChild;
      if(!cell) return;
      const del = cell.querySelector('.delete');
      cell.insertBefore(button, del || null);
    });
  }

  function updateFooter(){
    const btn = $('#clearDoneBtn');
    if(!btn) return;
    btn.hidden = active === ARCHIVE_TAB;
    if(active !== ARCHIVE_TAB) btn.textContent = '완료 항목 정리';
  }

  function archiveTask(task){
    if(!task) return;
    if(task.status !== 'done'){
      task.status = 'done';
      if(!task.completedAt) task.completedAt = Date.now();
    }
    task.archived = true;
    task.archivedAt = Date.now();
  }

  function restoreTask(task){
    if(!task) return;
    task.archived = false;
    task.archivedAt = null;
  }

  const previousRenderTasks = renderTasks;
  renderTasks = function(){
    previousRenderTasks();
    addArchiveButtons();
    updateFooter();
  };

  const previousRender = render;
  render = function(){
    previousRender();
    addArchiveButtons();
    updateFooter();
  };

  const body = $('#taskBody');
  if(body){
    body.addEventListener('click', e => {
      const archiveBtn = e.target.closest('.archive-task');
      const restoreBtn = e.target.closest('.restore-task');
      if(!archiveBtn && !restoreBtn) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const row = e.target.closest('tr[data-id]');
      const task = (state.tasks || []).find(t => String(t.id) === String(row?.dataset.id));
      if(!task) return;

      if(archiveBtn) archiveTask(task);
      else restoreTask(task);
      save();
      render();
    }, true);
  }

  const clear = $('#clearDoneBtn');
  if(clear){
    clear.onclick = () => {
      if(active === ARCHIVE_TAB) return;
      const targets = base().filter(t => t.status === 'done' && !isArchived(t));
      if(!targets.length) return alert('현재 탭에 정리할 완료 업무가 없습니다.');
      targets.forEach(archiveTask);
      save();
      render();
    };
  }

  installStyles();
  render();
})();
