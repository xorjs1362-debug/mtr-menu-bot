(() => {
  const isMobile = () => window.matchMedia('(max-width:600px)').matches;
  const desktopRenderTasks = renderTasks;

  function formatCompletedAt(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function installMobileCardStyles() {
    if (document.getElementById('mobileCardLayoutStyle')) return;
    const style = document.createElement('style');
    style.id = 'mobileCardLayoutStyle';
    style.textContent = `
      @media(max-width:600px){
        html,body{overflow-x:hidden!important;}
        .table-wrap{width:100%!important;max-width:100%!important;overflow-x:hidden!important;}
        .table-wrap table,.table-wrap tbody{
          display:block!important;
          width:100%!important;
          min-width:0!important;
          max-width:100%!important;
          table-layout:auto!important;
        }
        .table-wrap thead,.table-wrap colgroup{display:none!important;}

        #taskBody > tr{
          display:block!important;
          width:100%!important;
          min-width:0!important;
          max-width:100%!important;
          padding:0!important;
          margin:0!important;
          border:0!important;
          background:#fff!important;
        }
        #taskBody > tr.overdue{background:#fff8f8!important;}

        #taskBody > tr > td.mobile-task-cell{
          display:block!important;
          position:static!important;
          left:auto!important;
          width:100%!important;
          min-width:0!important;
          max-width:100%!important;
          height:auto!important;
          padding:0!important;
          margin:0!important;
          border:0!important;
          box-shadow:none!important;
          background:transparent!important;
          white-space:normal!important;
          text-align:left!important;
          box-sizing:border-box!important;
        }

        .mobile-task-card{
          width:100%;
          box-sizing:border-box;
          padding:12px 14px 11px;
          border-bottom:1px solid #e3e8ef;
        }

        .mobile-task-title-row{
          display:grid;
          grid-template-columns:28px minmax(0,1fr);
          gap:9px;
          align-items:start;
        }
        .mobile-task-title-row .check{
          width:20px!important;
          height:20px!important;
          margin:2px 0 0!important;
        }
        .mobile-task-title{
          min-width:0;
          font-size:14px;
          font-weight:800;
          line-height:1.45;
          color:#182235;
          white-space:normal!important;
          word-break:keep-all;
          overflow-wrap:anywhere;
        }
        .done .mobile-task-title{text-decoration:line-through;color:#7f8792;}
        .mobile-task-memo{
          margin-top:4px;
          font-size:11px;
          line-height:1.4;
          color:#7b8491;
          white-space:normal;
          word-break:keep-all;
          overflow-wrap:anywhere;
        }

        .mobile-task-info{
          margin:10px 0 0 37px;
          display:grid;
          gap:6px;
        }
        .mobile-info-row{
          display:grid;
          grid-template-columns:68px minmax(0,1fr);
          gap:8px;
          align-items:center;
          min-width:0;
        }
        .mobile-info-label{
          color:#8a929e;
          font-size:10px;
          font-weight:700;
          line-height:1.25;
          white-space:nowrap;
        }
        .mobile-info-value{
          min-width:0;
          color:#4f5968;
          font-size:11px;
          line-height:1.35;
          white-space:normal;
          word-break:keep-all;
          overflow-wrap:anywhere;
        }
        .mobile-info-value.date-value{white-space:nowrap;overflow-wrap:normal;}
        .mobile-info-value .tag{
          display:inline-block!important;
          width:auto!important;
          max-width:100%!important;
          padding:2px 6px!important;
          font-size:10px!important;
          white-space:nowrap!important;
        }
        .mobile-info-value .dday{
          display:inline-block!important;
          width:auto!important;
          max-width:none!important;
          margin-left:5px!important;
          padding:2px 5px!important;
          font-size:10px!important;
          white-space:nowrap!important;
        }

        .mobile-task-actions{
          margin:11px 0 0 37px;
          display:flex;
          gap:6px;
          align-items:center;
          flex-wrap:wrap;
        }
        .mobile-task-actions .task-drag-handle{
          width:42px!important;
          height:32px!important;
          flex:0 0 42px!important;
          margin:0!important;
        }
        .mobile-task-actions button{
          width:auto!important;
          min-width:52px!important;
          max-width:none!important;
          flex:0 0 auto!important;
          padding:6px 10px!important;
          margin:0!important;
          font-size:11px!important;
          line-height:1.2!important;
          white-space:nowrap!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function clearLegacyMobileWidths() {
    if (!isMobile()) return;
    const table = document.querySelector('.table-wrap table');
    if (!table) return;
    ['width','min-width','max-width','table-layout'].forEach(p => table.style.removeProperty(p));
    table.querySelectorAll('colgroup[data-layout]').forEach(x => x.remove());
    table.querySelectorAll('th,td').forEach(cell => {
      ['width','min-width','max-width','left','position'].forEach(p => cell.style.removeProperty(p));
    });
  }

  function mobileRenderTasks() {
    const a = filtered();
    $('#taskBody').innerHTML = a.map(t => {
      const overdue = t.status !== 'done' && t.dueDate && t.dueDate < today();
      const due = t.dueDate
        ? `${esc(t.dueDate)} <span class="dday">${dday(t.dueDate)}</span>`
        : '-';
      return `<tr data-id="${esc(t.id)}" class="${t.status==='done'?'done':''} ${overdue?'overdue':''}">
        <td colspan="9" class="mobile-task-cell">
          <div class="mobile-task-card">
            <div class="mobile-task-title-row">
              <input class="check" type="checkbox" ${t.status==='done'?'checked':''}>
              <div>
                <div class="mobile-task-title">${esc(t.title)}</div>
                ${t.memo ? `<div class="mobile-task-memo">${esc(t.memo)}</div>` : ''}
              </div>
            </div>
            <div class="mobile-task-info">
              <div class="mobile-info-row"><span class="mobile-info-label">프로젝트</span><span class="mobile-info-value"><span class="tag">${esc(pName(t.projectId))}</span></span></div>
              <div class="mobile-info-row"><span class="mobile-info-label">상태</span><span class="mobile-info-value"><span class="tag s-${t.status}">${statusLabel(t.status)}</span></span></div>
              <div class="mobile-info-row"><span class="mobile-info-label">우선순위</span><span class="mobile-info-value"><span class="tag p-${t.priority}">${priorityLabel(t.priority)}</span></span></div>
              <div class="mobile-info-row"><span class="mobile-info-label">작성일</span><span class="mobile-info-value date-value">${esc(t.createdDate||'-')}</span></div>
              <div class="mobile-info-row"><span class="mobile-info-label">마감일</span><span class="mobile-info-value date-value">${due}</span></div>
              <div class="mobile-info-row"><span class="mobile-info-label">완료일시</span><span class="mobile-info-value date-value">${esc(formatCompletedAt(t.completedAt))}</span></div>
            </div>
            <div class="mobile-task-actions">
              <span class="task-drag-handle" title="잡고 끌어서 할 일 순서 변경" role="button" aria-label="할 일 순서 변경" tabindex="0">↕</span>
              <button type="button" class="edit">수정</button>
              <button type="button" class="delete danger">삭제</button>
            </div>
          </div>
        </td>
      </tr>`;
    }).join('');
    $('#emptyState').hidden = a.length !== 0;
    $('#visibleInfo').textContent = `${a.length}개 표시`;
    clearLegacyMobileWidths();
    requestAnimationFrame(clearLegacyMobileWidths);
  }

  renderTasks = function() {
    if (isMobile()) mobileRenderTasks();
    else desktopRenderTasks();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    if (isMobile()) {
      clearLegacyMobileWidths();
      requestAnimationFrame(clearLegacyMobileWidths);
    }
  };

  installMobileCardStyles();
  $('#search').oninput = renderTasks;
  $('#filterStatus').onchange = renderTasks;

  let lastMobile = isMobile();
  const handleViewportChange = () => {
    const nowMobile = isMobile();
    if (nowMobile !== lastMobile) {
      lastMobile = nowMobile;
      render();
    } else if (nowMobile) {
      clearLegacyMobileWidths();
    }
  };
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(handleViewportChange, 80));

  if (isMobile()) renderTasks();
})();