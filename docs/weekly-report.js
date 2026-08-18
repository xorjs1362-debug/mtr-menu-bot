(() => {
  function pad(n){return String(n).padStart(2,'0');}
  function localISO(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
  function parseDate(s){
    if(!s) return null;
    const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0,0);
  }
  function startOfWeek(d){
    const x=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0,0);
    const day=x.getDay()||7;
    x.setDate(x.getDate()-day+1);
    return x;
  }
  function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
  function inRange(date,a,b){return date && date>=a && date<=b;}
  function fmtMD(d){return `${d.getMonth()+1}/${d.getDate()}`;}
  function completedDate(t){
    if(!t.completedAt) return null;
    const d=new Date(t.completedAt);
    return Number.isNaN(d.getTime())?null:d;
  }
  function projectName(t){
    const p=(state.projects||[]).find(x=>String(x.id)===String(t.projectId));
    return p?.name || '기타';
  }
  function taskBlock(t){
    const title=String(t.title||'').replace(/\r\n?/g,'\n').trim();
    const memo=String(t.memo||'').replace(/\r\n?/g,'\n').trim();
    const titleLines=title.split('\n').filter(Boolean);
    const lines=[];
    if(titleLines.length){
      lines.push(titleLines[0]);
      titleLines.slice(1).forEach(x=>lines.push(`      ${x}`));
    }
    if(memo){
      memo.split('\n').filter(Boolean).forEach(x=>lines.push(`      - ${x}`));
    }
    return lines.join('\n');
  }
  function buildDrafts(excludePersonal=true){
    const now=new Date();
    const currentStart=startOfWeek(now);
    const currentEnd=addDays(currentStart,6);
    currentEnd.setHours(23,59,59,999);
    const nextStart=addDays(currentStart,7);
    const nextEnd=addDays(currentStart,13);
    nextEnd.setHours(23,59,59,999);
    const todayDate=parseDate(localISO(now));

    const projectOrder=(state.projects||[])
      .filter(p=>!(excludePersonal && String(p.name).trim()==='개인'))
      .map(p=>String(p.name));
    if(!projectOrder.includes('기타')) projectOrder.push('기타');

    const groups=new Map(projectOrder.map(name=>[name,{name,current:[],next:[],notes:[]} ]));
    const ensure=name=>{
      if(!groups.has(name)) groups.set(name,{name,current:[],next:[],notes:[]});
      return groups.get(name);
    };

    (state.tasks||[]).forEach(t=>{
      const name=projectName(t);
      if(excludePersonal && name==='개인') return;
      const g=ensure(name);
      const due=parseDate(t.dueDate);
      const created=parseDate(t.createdDate);
      const completed=completedDate(t);
      const incomplete=t.status!=='done';
      const overdue=incomplete && due && todayDate && due<todayDate;
      const doneThisWeek=t.status==='done' && inRange(completed,currentStart,currentEnd);
      const dueThisWeek=incomplete && inRange(due,currentStart,currentEnd);
      const activeNow=incomplete && t.status==='doing';
      const newThisWeek=incomplete && inRange(created,currentStart,currentEnd);
      const dueNextWeek=incomplete && inRange(due,nextStart,nextEnd);
      const waiting=incomplete && t.status==='wait';
      const ongoingNoDue=incomplete && !due;

      if(doneThisWeek || overdue || dueThisWeek || activeNow || newThisWeek){
        g.current.push(t);
      }
      if(dueNextWeek || waiting || ongoingNoDue){
        g.next.push(t);
      }
      if(overdue){
        g.notes.push(`기한 초과: ${String(t.title||'').split(/\r?\n/)[0]} (${fmtMD(due)} 마감)`);
      }
    });

    const unique=arr=>{
      const seen=new Set();
      return arr.filter(t=>{const id=String(t.id);if(seen.has(id))return false;seen.add(id);return true;});
    };

    const result=[];
    groups.forEach(g=>{
      g.current=unique(g.current);
      g.next=unique(g.next);
      const currentText=g.current.map(taskBlock).filter(Boolean).join('\n');
      const nextText=g.next.map(taskBlock).filter(Boolean).join('\n');
      const notesText=[...new Set(g.notes)].join('\n');
      if(currentText || nextText || notesText){
        result.push({name:g.name,currentText,nextText,notesText});
      }
    });

    return {
      currentStart,currentEnd,nextStart,nextEnd,
      items:result
    };
  }

  function installStyles(){
    if(document.getElementById('weeklyReportStyle')) return;
    const style=document.createElement('style');
    style.id='weeklyReportStyle';
    style.textContent=`
      #weeklyReportBtn{font-weight:800;}
      .weekly-backdrop{position:fixed;inset:0;z-index:60;background:#0f172a73;display:none;place-items:center;padding:16px;}
      .weekly-backdrop.show{display:grid;}
      .weekly-modal{width:min(1040px,100%);max-height:92vh;display:flex;flex-direction:column;background:#fff;border:1px solid #e2e7ee;border-radius:16px;box-shadow:0 24px 70px #0004;overflow:hidden;}
      .weekly-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:15px 17px;border-bottom:1px solid #e2e7ee;}
      .weekly-head h2{margin:0;font-size:18px;}
      .weekly-head p{margin:4px 0 0;color:#6f7888;font-size:11px;}
      .weekly-head-actions{display:flex;gap:6px;align-items:center;}
      .weekly-options{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 17px;background:#fbfcfe;border-bottom:1px solid #edf0f4;}
      .weekly-options label{display:flex;align-items:center;gap:6px;font-size:12px;color:#566174;font-weight:700;}
      .weekly-options input[type=checkbox]{width:16px;height:16px;}
      .weekly-range{font-size:12px;color:#2f6fed;font-weight:800;}
      .weekly-body{overflow:auto;padding:14px 17px;display:grid;gap:12px;}
      .weekly-empty{padding:36px 12px;text-align:center;color:#7b8494;}
      .weekly-project{border:1px solid #e1e6ed;border-radius:13px;overflow:hidden;}
      .weekly-project-title{padding:10px 12px;background:#f8faff;font-size:14px;font-weight:900;color:#203052;border-bottom:1px solid #e7ebf1;}
      .weekly-grid{display:grid;grid-template-columns:1fr 1fr .72fr;gap:0;}
      .weekly-field{padding:10px;border-right:1px solid #edf0f4;}
      .weekly-field:last-child{border-right:0;}
      .weekly-field-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;}
      .weekly-field-head b{font-size:11px;color:#697487;}
      .weekly-copy{padding:4px 7px;font-size:10px;}
      .weekly-text{width:100%;min-height:130px;resize:vertical;line-height:1.55;font-size:12px;white-space:pre-wrap;}
      .weekly-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 17px;border-top:1px solid #e2e7ee;background:#fff;}
      .weekly-foot .hint{font-size:10px;color:#7a8493;}
      .weekly-foot-actions{display:flex;gap:7px;}
      @media(max-width:700px){
        .weekly-backdrop{padding:8px;}
        .weekly-modal{max-height:96vh;border-radius:13px;}
        .weekly-head{padding:12px;}
        .weekly-options{padding:9px 12px;}
        .weekly-body{padding:10px 12px;}
        .weekly-grid{grid-template-columns:1fr;}
        .weekly-field{border-right:0;border-bottom:1px solid #edf0f4;}
        .weekly-field:last-child{border-bottom:0;}
        .weekly-text{min-height:100px;}
        .weekly-foot{padding:10px 12px;align-items:flex-end;}
        .weekly-foot .hint{max-width:50%;}
      }
    `;
    document.head.appendChild(style);
  }

  function installUI(){
    if(document.getElementById('weeklyReportBtn')) return;
    const headerActions=document.querySelector('.header-actions');
    if(headerActions){
      const btn=document.createElement('button');
      btn.id='weeklyReportBtn';
      btn.type='button';
      btn.textContent='주간업무 정리';
      const manage=document.getElementById('manageProjectsBtn');
      headerActions.insertBefore(btn,manage||null);
    }

    const backdrop=document.createElement('div');
    backdrop.id='weeklyBackdrop';
    backdrop.className='weekly-backdrop';
    backdrop.innerHTML=`
      <div class="weekly-modal" role="dialog" aria-modal="true" aria-labelledby="weeklyTitle">
        <div class="weekly-head">
          <div><h2 id="weeklyTitle">주간업무 내용 정리</h2><p>현재 할 일 목록을 주간업무 PPT 형식에 맞춰 프로젝트별 초안으로 정리합니다.</p></div>
          <div class="weekly-head-actions"><button type="button" id="weeklyClose">×</button></div>
        </div>
        <div class="weekly-options">
          <label><input id="weeklyExcludePersonal" type="checkbox" checked> 개인 프로젝트 제외</label>
          <span id="weeklyRange" class="weekly-range"></span>
          <button type="button" id="weeklyRefresh">다시 정리</button>
        </div>
        <div id="weeklyBody" class="weekly-body"></div>
        <div class="weekly-foot">
          <span class="hint">자동 정리된 초안이므로 필요 없는 항목은 지우고 표현을 다듬어 사용하시면 됩니다.</span>
          <div class="weekly-foot-actions"><button type="button" id="weeklyCopyAll" class="primary">전체 복사</button><button type="button" id="weeklyDone">닫기</button></div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
  }

  function escHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function renderDraft(){
    const exclude=document.getElementById('weeklyExcludePersonal')?.checked!==false;
    const draft=buildDrafts(exclude);
    document.getElementById('weeklyRange').textContent=`금주 ${fmtMD(draft.currentStart)}~${fmtMD(draft.currentEnd)} · 차주 ${fmtMD(draft.nextStart)}~${fmtMD(draft.nextEnd)}`;
    const body=document.getElementById('weeklyBody');
    if(!draft.items.length){
      body.innerHTML='<div class="weekly-empty">정리할 주간업무 항목이 없습니다.</div>';
      return;
    }
    body.innerHTML=draft.items.map((g,i)=>`
      <section class="weekly-project" data-weekly-project="${i}" data-project-name="${escHtml(g.name)}">
        <div class="weekly-project-title">${escHtml(g.name)}</div>
        <div class="weekly-grid">
          <div class="weekly-field"><div class="weekly-field-head"><b>금주 현안</b><button type="button" class="weekly-copy" data-copy-field="current">복사</button></div><textarea class="weekly-text" data-field="current">${escHtml(g.currentText)}</textarea></div>
          <div class="weekly-field"><div class="weekly-field-head"><b>차주/계획</b><button type="button" class="weekly-copy" data-copy-field="next">복사</button></div><textarea class="weekly-text" data-field="next">${escHtml(g.nextText)}</textarea></div>
          <div class="weekly-field"><div class="weekly-field-head"><b>비고</b><button type="button" class="weekly-copy" data-copy-field="notes">복사</button></div><textarea class="weekly-text" data-field="notes">${escHtml(g.notesText)}</textarea></div>
        </div>
      </section>`).join('');
  }

  async function copyText(text,button){
    try{
      await navigator.clipboard.writeText(text||'');
    }catch{
      const ta=document.createElement('textarea');
      ta.value=text||'';ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
    }
    if(button){const old=button.textContent;button.textContent='복사됨';setTimeout(()=>button.textContent=old,900);}
  }

  function collectAll(){
    const sections=[...document.querySelectorAll('#weeklyBody .weekly-project')];
    return sections.map(section=>{
      const name=section.dataset.projectName||'';
      const get=f=>section.querySelector(`[data-field="${f}"]`)?.value.trim()||'';
      return `[${name}]\n금주 현안\n${get('current')||'-'}\n\n차주/계획\n${get('next')||'-'}\n\n비고\n${get('notes')||'-'}`;
    }).join('\n\n--------------------\n\n');
  }

  function openWeekly(){
    renderDraft();
    document.getElementById('weeklyBackdrop').classList.add('show');
  }
  function closeWeekly(){document.getElementById('weeklyBackdrop').classList.remove('show');}

  function bind(){
    document.getElementById('weeklyReportBtn').onclick=openWeekly;
    document.getElementById('weeklyClose').onclick=closeWeekly;
    document.getElementById('weeklyDone').onclick=closeWeekly;
    document.getElementById('weeklyRefresh').onclick=renderDraft;
    document.getElementById('weeklyExcludePersonal').onchange=renderDraft;
    document.getElementById('weeklyCopyAll').onclick=e=>copyText(collectAll(),e.currentTarget);
    document.getElementById('weeklyBody').onclick=e=>{
      const btn=e.target.closest('[data-copy-field]');
      if(!btn) return;
      const section=btn.closest('.weekly-project');
      const field=btn.dataset.copyField;
      const value=section.querySelector(`[data-field="${field}"]`)?.value||'';
      copyText(value,btn);
    };
    document.getElementById('weeklyBackdrop').addEventListener('click',e=>{if(e.target.id==='weeklyBackdrop')closeWeekly();});
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('weeklyBackdrop').classList.contains('show'))closeWeekly();});
  }

  installStyles();
  installUI();
  bind();
})();
