import React,{useEffect,useState,useRef} from 'react';
import {Database,Download,Loader2} from 'lucide-react';
import {download} from './NspdObjects.jsx';
async function call(method='GET',action='probe'){
 const r=await fetch('/api/rosreestr/source',{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:JSON.stringify({action})}:{})});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось проверить источник');return d;
}
export default function RosreestrSource(){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const requestActive=useRef(false);
 useEffect(()=>{let stopped=false;call().then(d=>{if(!stopped&&!requestActive.current)setData(d)}).catch(e=>{if(!stopped)setError(e.message)});return()=>{stopped=true}},[]);
 useEffect(()=>{if(!busy)return;let active=true;const timer=setInterval(()=>{call().then(d=>{if(active&&requestActive.current&&d.busy)setData(d)}).catch(()=>{})},1500);return()=>{active=false;clearInterval(timer)}},[busy]);
 async function check(action){requestActive.current=true;setBusy(true);setError('');try{setData(await call('POST',action))}catch(e){setError(e.message)}finally{requestActive.current=false;setBusy(false)}}
 const attempt=data?.lastAttempt,hasCache=data?.cacheCount>0;
 return <section className="panel rosreestr-source">
  <h3><Database size={18}/> Источник сделок: Росреестр</h3>
  <p>Опубликованные кварталы за последние 12 месяцев. Небольшие исходные фрагменты сохраняются на этом компьютере, даже если формат таблицы пока не распознан. После проверки формата подключим цены к калькулятору.</p>
  <div className="settings-actions">
   <button className="btn secondary" disabled={busy||data?.busy} onClick={()=>check(hasCache?'reparse':'probe')}>{busy&&<Loader2 size={16} className="spin"/>}{hasCache?'Разобрать сохранённые образцы':'Проверить источник сделок'}</button>
   {hasCache&&<button className="btn secondary" disabled={busy||data?.busy} onClick={()=>check('probe')}>Запросить свежие образцы</button>}
  </div>
  {error&&<p role="status">{error}</p>}
  {hasCache&&<p>Сохранено исходных фрагментов: {data.cacheCount}. Повторный разбор работает без обращения к Росреестру. Исходные фрагменты включены в скачиваемый отчёт.</p>}
  {attempt&&<>
   <p role="status">{attempt.message}</p>
   <small className="muted">{new Date(attempt.checkedAt).toLocaleString('ru-RU')} · {attempt.fromCache?'Разбор из сохранённых файлов · запросов к Росреестру: 0':`HTTP ${attempt.httpStatus??'—'}${attempt.sampleHTTP?' / файл: '+attempt.sampleHTTP:''}`}</small>
   {attempt.window&&<p>Период: {new Date(attempt.window.from).toLocaleDateString('ru-RU')} — {new Date(attempt.window.to).toLocaleDateString('ru-RU')}. Найдено файлов: {attempt.files?.length||0}; распознано таблиц: {attempt.samples?.length||0}.{attempt.files?.some(f=>f.partialPeriod)&&' Крайний квартал попадает в период частично: для отбора сделок понадобятся их даты.'}</p>}
   {attempt.fileReads?.length>0&&<details open><summary>Результат по периодам</summary><ul>{attempt.fileReads.map(r=><li key={r.file.url}>{r.file.period||r.file.catalogPeriod||'Период не определён'} · версия {r.file.version||1}: {r.status==='parsed'?'образец таблицы распознан':r.message||'образец сохранён'}{r.prefixRetained?' Исходные байты сохранены.':''}</li>)}</ul></details>}
   {data.documentationCache?.length>0&&<p>Сохранено описаний формата и справочников: {data.documentationCache.length}.</p>}{attempt.documentation?.some(d=>d.status!=='pdf_received')&&<p>Не все описания формата получены. Их состояние включено в отчёт; сохранённые образцы таблиц доступны для разбора.</p>}{attempt.folders?.length>0&&<details><summary>Проверенные папки периодов</summary><ul>{attempt.folders.map(f=><li key={f.url}>{f.name}: HTTP {f.httpStatus??'—'}, файлов сделок: {f.fileCount??'—'}</li>)}</ul></details>}
   {attempt.page&&<details><summary>Что ответил сайт</summary><p>Заголовок: {attempt.page.title||'Заголовок отсутствует'}. Тип: {attempt.page.contentType||'Не указан'}. Получено {attempt.page.byteLength} байт; ссылок: {attempt.page.linkCount}; скриптов: {attempt.page.scriptCount}.</p>{attempt.page.fileNames.length>0&&<p>Найдены имена файлов: {attempt.page.fileNames.join(', ')}</p>}</details>}
   {attempt.sample&&<details><summary>Подробности таблиц</summary><p>Это образцы для проверки формата, а не подтверждённые сделки населённого пункта. ZIP прочитан частично; целостность полного архива пока не проверялась.</p>{attempt.samples?.map(s=><p key={s.file.url}>{s.file.period||s.file.catalogPeriod||'Период файла не определён'}: {s.file.name}; полей: {s.headers.length}; строк образца: {s.rows.length}. {s.dataset&&'Официальные столбцы распознаны. Это квартальные группы, а не подтверждённые отдельные сделки.'}</p>)}</details>}
   <div className="settings-actions"><button className="btn secondary" onClick={()=>download(data,'rosreestr-source-report.json')}><Download size={16}/>Скачать отчёт источника</button><a className="text-link" href={data.catalogURL} target="_blank" rel="noreferrer">Официальный каталог Росреестра ↗</a></div>
  </>}
 </section>;
}
