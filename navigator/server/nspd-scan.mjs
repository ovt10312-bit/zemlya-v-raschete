import {randomUUID} from 'node:crypto';
import {planCells,splitCell,objectKey,screenObject} from '../src/nspd-scan-domain.mjs';
const terminal=new Set(['completed','completed_partial']);
export function createNspdScanner({db,getTerritory,query,gapMs=1500,clock=()=>Date.now()}){
 db.exec('CREATE TABLE IF NOT EXISTS nspd_scan_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS nspd_scan_objects(run_id TEXT NOT NULL,object_key TEXT NOT NULL,screen_status TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,object_key));');
 const read=id=>{const row=id?db.prepare('SELECT payload FROM nspd_scan_runs WHERE id=?').get(id):db.prepare('SELECT payload FROM nspd_scan_runs ORDER BY rowid DESC LIMIT 1').get();return row?JSON.parse(row.payload):null;};
 const save=job=>db.prepare('INSERT INTO nspd_scan_runs(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(job.id,JSON.stringify({...job,updatedAt:new Date(clock()).toISOString()}));
 const addEvent=(job,message)=>{job.events.push({at:new Date(clock()).toISOString(),message});job.events=job.events.slice(-40);};
 for(const row of db.prepare('SELECT payload FROM nspd_scan_runs').all()){const job=JSON.parse(row.payload);if(['running','pausing'].includes(job.status)){job.status='paused';for(const c of job.cells)if(c.status==='running')c.status='pending';addEvent(job,'После перезапуска обход на паузе. Можно продолжить.');save(job);}}
 let active=null,controller=null,wake=null;
 function summary(job){if(!job)return null;const counts=Object.fromEntries(db.prepare('SELECT screen_status,COUNT(*) n FROM nspd_scan_objects WHERE run_id=? GROUP BY screen_status').all(job.id).map(r=>[r.screen_status,r.n])),unique=Object.values(counts).reduce((n,v)=>n+v,0);const leaves=job.cells.filter(c=>c.status!=='split'),done=leaves.filter(c=>c.status==='done'),partial=leaves.filter(c=>c.status==='partial');const totalArea=leaves.reduce((s,c)=>s+c.area,0),doneArea=done.reduce((s,c)=>s+c.area,0);return {id:job.id,status:job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,territory:{id:job.territory.id,name:job.territory.name},cellMetres:500,cellsTotal:leaves.length,cellsDone:done.length,cellsPartial:partial.length,coveragePercent:totalArea?Math.min(100,Math.round(doneArea/totalArea*1000)/10):0,requests:job.requests,received:job.received,unique,deduplicated:Math.max(0,job.received-unique),review:counts.review||0,unknown:counts.unknown||0,excluded:counts.excluded||0,message:job.message||'',retryAt:job.retryAt||null,events:job.events,stopping:active===job.id&&job.status==='pausing'};}
 function status(){return {job:summary(read()),runs:db.prepare('SELECT payload FROM nspd_scan_runs ORDER BY rowid DESC LIMIT 30').all().map(r=>{const j=JSON.parse(r.payload);return {id:j.id,createdAt:j.createdAt,status:j.status,territoryName:j.territory.name};})};}
 function isBusy(){return active!==null;}
 function results({id,status='all',offset=0,limit=100}={}){const job=read(id);if(!job)return {job:null,objects:[],total:0};if(!['all','review','unknown','excluded'].includes(status))throw Error('Неизвестный фильтр.');offset=Math.max(0,Math.min(100000,Number(offset)||0));limit=Math.max(1,Math.min(100,Number(limit)||100));const clause=status==='all'?'run_id=?':'run_id=? AND screen_status=?',args=status==='all'?[job.id]:[job.id,status];const total=db.prepare('SELECT COUNT(*) n FROM nspd_scan_objects WHERE '+clause).get(...args).n,rows=db.prepare('SELECT payload FROM nspd_scan_objects WHERE '+clause+' ORDER BY object_key LIMIT ? OFFSET ?').all(...args,limit,offset).map(r=>JSON.parse(r.payload));return {job:summary(job),total,offset,objects:rows,boundary:job.territory.geometry};}
 function exportResult(id){const job=read(id);if(!job)return {job:null,objects:[]};return {job:summary(job),boundary:job.territory.geometry,cells:job.cells,objects:db.prepare('SELECT payload FROM nspd_scan_objects WHERE run_id=?').all(job.id).map(r=>JSON.parse(r.payload)),notice:'Предварительный обход ЕГРН. Права и ограничения не проверены; отсутствие контура не означает свободную землю.'};}
 function validTerritory(job){const t=getTerritory();if(!t?.usable||t.id!==job.territory.id||t.boundaryVersion!==job.territory.boundaryVersion)throw Error('Выбранная граница изменилась. Для продолжения выбери исходную актуальную границу либо начни новый обход.');}
 function start(){if(active)throw Error('Обход уже выполняется.');const old=read();if(old&&!terminal.has(old.status))throw Error('Есть незавершённый обход. Продолжи его или сначала заверши остановкой.');const territory=getTerritory();if(!territory?.usable)throw Error('Сначала выбери и примени актуальную границу населённого пункта.');const now=new Date(clock()).toISOString(),job={id:randomUUID(),createdAt:now,status:'running',territory,cells:planCells(territory.geometry),events:[],requests:0,received:0};addEvent(job,`План готов: фрагментов ${job.cells.length}. Запросы ЕГРН выполняются последовательно.`);save(job);launch(job.id);return status();}
 function pause(){const job=read();if(!job||job.status!=='running')return status();job.status=active?'pausing':'paused';addEvent(job,'Запрошена пауза. Уже полученные данные сохраняются.');save(job);controller?.abort();wake?.();return status();}
 function resume(){const job=read();if(active)throw Error('Предыдущий запрос ещё завершается.');if(!job||job.status!=='paused')throw Error('Нет обхода на паузе.');validTerritory(job);if(job.retryAt&&clock()<job.retryAt)throw Error('Источник попросил подождать до '+new Date(job.retryAt).toLocaleString('ru-RU'));job.status='running';job.message='';addEvent(job,'Обход продолжен с сохранённого места.');save(job);launch(job.id);return status();}
 function finish(){if(active)throw Error('Сначала поставь обход на паузу и дождись остановки запроса.');const job=read();if(job&&!terminal.has(job.status)){job.status='completed_partial';job.message='Обход завершён пользователем. Территория обследована частично.';addEvent(job,job.message);save(job);}return status();}
 function launch(id){active=id;run(id).catch(e=>{const job=read(id);if(job){job.status='paused';job.message='Обход остановлен из-за внутренней ошибки. Сохранённые результаты доступны.';addEvent(job,job.message);save(job);}console.error('NSPD scan error:',e.message);}).finally(()=>{active=null;controller=null;wake=null;});}
 async function run(id){
  while(true){let job=read(id);if(job.status!=='running'){if(job.status==='pausing'){job.status='paused';for(const c of job.cells)if(c.status==='running')c.status='pending';save(job);}return;}
   try{validTerritory(job);}catch(e){job.status='paused';job.message=e.message;addEvent(job,job.message);save(job);return;}
   const cell=job.cells.find(c=>c.status==='pending');
   if(!cell){job.status=job.cells.some(c=>c.status==='partial')?'completed_partial':'completed';job.message=job.status==='completed'?'Обход по ответам ЕГРН завершён. Полнота источника, права и ограничения не подтверждены.':'Обход завершён с неполными фрагментами. Полнота территории не подтверждена.';addEvent(job,job.message);save(job);return;}
   cell.status='running';addEvent(job,`Запрос фрагмента ${cell.id}`);save(job);controller=new AbortController();const r=await query(cell,controller.signal);controller=null;
   job=read(id);const current=job.cells.find(c=>c.id===cell.id);
   if(job.status!=='running'){current.status='pending';job.status='paused';save(job);return;}
   job.requests++;current.checkedAt=r.checkedAt;current.httpStatus=r.httpStatus;current.count=r.count??null;current.sourceStatus=r.status;
   const oversized=r.status==='too_large'||r.possiblyTruncated;
   if(r.status!=='available'&&!oversized){current.status='pending';job.status='paused';job.message=`Фрагмент ${cell.id}: ${r.message||'Данные не получены'}`;if(r.status==='limited'){const seconds=Number(r.retryAfter),date=Date.parse(r.retryAfter||'');job.retryAt=Math.max(clock()+30000,Number.isFinite(seconds)&&seconds>0?clock()+seconds*1000:Number.isFinite(date)?date:clock()+60000);}addEvent(job,job.message);save(job);return;}
   db.exec('BEGIN IMMEDIATE');try{
    for(const [index,o]of (r.objects||[]).entries()){
     const key=objectKey(o,cell.id,index),old=db.prepare('SELECT payload FROM nspd_scan_objects WHERE run_id=? AND object_key=?').get(id,key),previous=old?JSON.parse(old.payload):null;
     const sourceConflicts=new Set(previous?.sourceConflicts||[]);
     for(const field of ['ownership_type','permitted_use_established_by_document']){const a=previous?.attributes?.[field],b=o.attributes?.[field];if(a&&b&&String(a).trim().toLowerCase()!==String(b).trim().toLowerCase())sourceConflicts.add(field);}
     if(previous?.areaM2!=null&&o.areaM2!=null&&previous.areaM2!==o.areaM2)sourceConflicts.add('area');
     const withConflicts={...o,sourceConflicts:[...sourceConflicts]};
     const object={...withConflicts,screening:screenObject(withConflicts,job.territory.geometry),firstSeenAt:previous?.firstSeenAt||r.checkedAt,lastSeenAt:r.checkedAt,sightings:(previous?.sightings||0)+1};
     db.prepare('INSERT INTO nspd_scan_objects(run_id,object_key,screen_status,payload) VALUES(?,?,?,?) ON CONFLICT(run_id,object_key) DO UPDATE SET screen_status=excluded.screen_status,payload=excluded.payload').run(id,key,object.screening.status,JSON.stringify(object));
    }
    job.received+=(r.objects||[]).length;
    if(oversized&&cell.depth<3&&job.cells.length<3900){const children=splitCell(job.territory.geometry,cell);current.status=children.length?'split':'partial';job.cells.push(...children);addEvent(job,children.length?`Фрагмент ${cell.id} разделён: ответ слишком велик или мог быть обрезан.`:`Фрагмент ${cell.id}: данные неполны, дальнейшее деление невозможно.`);}
    else {current.status=oversized?'partial':'done';addEvent(job,`Фрагмент ${cell.id}: ${r.count==null?'число объектов не определено':r.count+' объектов'}${oversized?', неполный ответ':''}.`);}
    if(db.prepare('SELECT COUNT(*) n,SUM(length(payload)) bytes FROM nspd_scan_objects WHERE run_id=?').get(id).n>=10000||db.prepare('SELECT SUM(length(payload)) bytes FROM nspd_scan_objects WHERE run_id=?').get(id).bytes>=50000000){job.status='paused';job.message='Достигнут лимит первого обхода (10 000 объектов или 50 МБ). Сохранённые результаты доступны.';addEvent(job,job.message);}
    save(job);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   if(job.status!=='running')return;
   await new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},gapMs);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
  }
 }
 return {status,results,exportResult,start,pause,resume,finish,isBusy};
}
