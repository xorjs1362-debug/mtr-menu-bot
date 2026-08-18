(() => {
  const isMobile = () => window.matchMedia('(max-width:600px)').matches;

  function installMobileFixStyles() {
    if (document.getElementById('mobileLayoutFixStyle')) return;
    const style = document.createElement('style');
    style.id = 'mobileLayoutFixStyle';
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

        #taskBody tr{
          display:grid!important;
          grid-template-columns:38px minmax(0,1fr)!important;
          width:100%!important;
          min-width:0!important;
          max-width:100%!important;
          gap:0!important;
          padding:10px 8px!important;
          box-sizing:border-box!important;
          border-bottom:1px solid #e4e9f0!important;
          background:#fff!important;
        }
        #taskBody tr.overdue{background:#fff8f8!important;}

        #taskBody td{
          position:static!important;
          left:auto!important;
          display:block!important;
          width:auto!important;
          min-width:0!important;
          max-width:none!important;
          height:auto!important;
          padding:4px 2px!important;
          margin:0!important;
          border:0!important;
          box-shadow:none!important;
          background:transparent!important;
          white-space:normal!important;
          overflow:visible!important;
          overflow-wrap:normal!important;
          word-break:keep-all!important;
          text-align:left!important;
          line-height:1.4!important;
          box-sizing:border-box!important;
        }

        #taskBody td:nth-child(1){
          grid-column:1!important;
          grid-row:1!important;
          padding-top:5px!important;
          text-align:center!important;
        }
        #taskBody td:nth-child(1) .check{
          width:20px!important;
          height:20px!important;
        }

        #taskBody td:nth-child(2){
          grid-column:2!important;
          grid-row:1!important;
          padding:2px 2px 8px 4px!important;
        }
        #taskBody td:nth-child(2) b{
          display:block!important;
          width:100%!important;
          max-width:100%!important;
          white-space:normal!important;
          overflow:visible!important;
          text-overflow:clip!important;
          word-break:keep-all!important;
          overflow-wrap:anywhere!important;
          font-size:14px!important;
          line-height:1.45!important;
        }
        #taskBody td:nth-child(2) .memo{
          display:block!important;
          white-space:normal!important;
          overflow:visible!important;
          font-size:11px!important;
          margin-top:3px!important;
        }

        #taskBody td:nth-child(n+3):nth-child(-n+8){
          grid-column:2!important;
          display:flex!important;
          align-items:flex-start!important;
          gap:8px!important;
          min-height:27px!important;
          padding:4px 2px 4px 4px!important;
          font-size:11px!important;
        }
        #taskBody td:nth-child(n+3):nth-child(-n+8)::before{
          flex:0 0 58px!important;
          width:58px!important;
          color:#7d8796!important;
          font-size:10px!important;
          font-weight:700!important;
          line-height:1.5!important;
          margin:0!important;
        }
        #taskBody td:nth-child(3)::before{content:'프로젝트'!important;}
        #taskBody td:nth-child(4)::before{content:'상태'!important;}
        #taskBody td:nth-child(5)::before{content:'우선순위'!important;}
        #taskBody td:nth-child(6)::before{content:'작성일'!important;}
        #taskBody td:nth-child(7)::before{content:'마감일'!important;}
        #taskBody td:nth-child(8)::before{content:'완료일시'!important;}

        #taskBody td:nth-child(3) .tag,
        #taskBody td:nth-child(4) .tag,
        #taskBody td:nth-child(5) .tag{
          display:inline-block!important;
          width:auto!important;
          max-width:calc(100% - 66px)!important;
          white-space:normal!important;
          word-break:keep-all!important;
          overflow-wrap:anywhere!important;
          font-size:10px!important;
          padding:2px 5px!important;
        }
        #taskBody td:nth-child(6),
        #taskBody td:nth-child(7),
        #taskBody td:nth-child(8){
          white-space:normal!important;
          word-break:keep-all!important;
          overflow-wrap:normal!important;
        }
        #taskBody td:nth-child(7) .dday{
          display:inline-block!important;
          width:auto!important;
          max-width:none!important;
          margin:0 0 0 4px!important;
          white-space:nowrap!important;
          font-size:10px!important;
        }
        #taskBody .completed-date,#taskBody .completed-time{
          display:inline!important;
          white-space:nowrap!important;
        }
        #taskBody .completed-time::before{content:' '!important;}

        #taskBody td:nth-child(9){
          grid-column:2!important;
          display:flex!important;
          align-items:center!important;
          gap:5px!important;
          flex-wrap:nowrap!important;
          padding:8px 2px 2px 4px!important;
        }
        #taskBody td:nth-child(9) .order-controls{
          display:flex!important;
          flex:0 0 auto!important;
          width:auto!important;
          gap:4px!important;
          margin:0!important;
        }
        #taskBody td:nth-child(9) .order-controls button,
        #taskBody td:nth-child(9) > button{
          width:auto!important;
          min-width:36px!important;
          max-width:none!important;
          flex:0 0 auto!important;
          padding:6px 8px!important;
          margin:0!important;
          font-size:11px!important;
          white-space:nowrap!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function clearForcedWidths() {
    if (!isMobile()) return;
    const table = document.querySelector('.table-wrap table');
    if (!table) return;

    ['width','min-width','max-width','table-layout'].forEach(p => table.style.removeProperty(p));
    table.querySelectorAll('colgroup[data-layout]').forEach(x => x.remove());
    table.querySelectorAll('th,td').forEach(cell => {
      ['width','min-width','max-width','left','position'].forEach(p => cell.style.removeProperty(p));
    });
  }

  function applyMobileFix() {
    installMobileFixStyles();
    clearForcedWidths();
    requestAnimationFrame(clearForcedWidths);
  }

  const previousRenderTasks = renderTasks;
  renderTasks = function() {
    previousRenderTasks();
    applyMobileFix();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    applyMobileFix();
  };

  window.addEventListener('resize', applyMobileFix);
  window.addEventListener('orientationchange', applyMobileFix);
  applyMobileFix();
})();