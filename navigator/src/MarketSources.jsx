import React,{useEffect,useRef,useState} from 'react';
import {requestBrowserExtension} from './market-extension.mjs';
import CometMarket from './CometMarket.jsx';
import RosreestrReferences from './RosreestrReferences.jsx';
import {download} from './NspdObjects.jsx';
import {requestMarket} from './market-client.mjs';
import {marketOfferSummary} from './market-summary.mjs';
import MarketOfferSummary from './MarketOfferSummary.jsx';
import {isAvitoIPRestricted} from './market-access.mjs';
export default function MarketSources({parcel,onUse,onAutomaticUse=onUse,onQuarterChange}){
 const [data,setData]=useState(null),[urls,setURLs]=useState({avito:'',cian:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const version=useRef(0);
 const call=(body,signal)=>requestMarket({parcelId:parcel.id,body,signal});
 useEffect(()=>{const controller=new AbortController(),current=++version.current;setData(null);setError('');setBusy(false);if(!parcel.demo)call(undefined,controller.signal).then(d=>{if(version.current===current)setData(d)}).catch(e=>{if(!controller.signal.aborted&&version.current===current)setError(e.message)});return()=>{controller.abort();version.current++}},[parcel.id]);
 useEffect(()=>{
  if(data?.jobStatus!=='running')return;const controller=new AbortController();let timer;
  async function poll(){try{const next=await call(undefined,controller.signal);if(controller.signal.aborted)return;setData(next);setError('');if(next?.jobStatus!=='running')return}catch(e){if(controller.signal.aborted)return;setError(e.message)}timer=setTimeout(poll,2000)}
  timer=setTimeout(poll,1000);return()=>{controller.abort();clearTimeout(timer)};
 },[parcel.id,data?.jobStatus]);
 async function refresh(){const current=version.current;try{const next=await call();if(version.current===current){setData(next);setError('')}}catch(e){if(version.current===current)setError(e.message)}}
 async function run(source){const current=++version.current;setBusy(true);setError('');try{const next=await call({parcelId:parcel.id,...urls,source});if(version.current===current)setData(next)}catch(e){if(version.current===current)setError(e.message);/* Never repeat POST after a lost response: the job may already be running. */try{const next=await call();if(version.current===current)setData(next)}catch{}}finally{if(version.current===current)setBusy(false)}}
 async function runExtension(){
  const current=++version.current;setBusy(true);setError('');
  try{
   await requestBrowserExtension('ping');
   let cian;
   try{cian=await call({source:'cian'})}catch{try{cian=await call()}catch{}}
   const result=await requestBrowserExtension('collect',{settlement:parcel.settlement,region:parcel.region,usage:parcel.usage});
   if(current!==version.current)return;
   const deadline=Date.now()+100000;
   while(cian?.jobStatus==='running'){
    if(Date.now()>deadline)throw Error('ЦИАН пока не завершил поиск. Полученный ответ Авито не передан; проверь состояние поиска.');
    await new Promise(resolve=>setTimeout(resolve,1000));if(current!==version.current)return;cian=await call();
   }
   const next=await call({action:'browserResult',result});if(current!==version.current)return;
   setData(next);const rows=marketOfferSummary(next.sources,parcel).eligible;
   if(rows.length)await onAutomaticUse(rows);
  }catch(e){if(current===version.current)setError(e.message)}finally{if(current===version.current)setBusy(false)}
 }
 const running=busy||data?.jobStatus==='running',avitoRestricted=data?.sources?.some(isAvitoIPRestricted);
 const summary=marketOfferSummary(data?.sources,parcel),values=summary.eligible;
 return <><RosreestrReferences parcel={parcel} onUse={onUse} onQuarterChange={onQuarterChange}/><div className="panel"><h3>Авито и ЦИАН · до 25 объявлений с каждого сайта</h3><p>Автоматический поиск в Comet: расширение само выбирает населённый пункт и читает до 25 карточек Авито. ЦИАН проверяется параллельно обычным загрузчиком. Полученные цены передаются в расчёт и сохраняются.</p><button className="btn primary" disabled={running||parcel.demo} onClick={runExtension}>{busy?'Получаем цены в браузере…':'Получить цены Авито и ЦИАН'}</button><details><summary>Первое подключение — один раз</summary><ol><li>В Comet открой <code>chrome://extensions</code> и включи «Режим разработчика».</li><li>Нажми «Загрузить распакованное расширение» и выбери папку <code>navigator\browser-extension</code> внутри папки программы.</li><li>Открой в Comet <code>http://127.0.0.1:8787</code>, войди в кабинет и нажми кнопку получения цен.</li></ol><p>После установки копировать задания и ответы не нужно. При проверке доступа Авито поиск остановится, вкладка останется открытой.</p></details><details><summary>Резервный ручной ввод</summary><CometMarket key={parcel.id} parcel={parcel} onUse={onUse}/></details><details><summary>Другой браузер и дополнительные настройки</summary><p>Навигатор открывает отдельное окно Edge или Chrome и выполняет поиск с этого компьютера. Для Авито сам выбирает населённый пункт и земельные участки. Объявления для расчёта подбираются по населённому пункту и назначению участка. Кадастровый квартал не требуется.</p><details><summary>Дополнительно: ссылки и доступ</summary><p>Обычно заполнять не нужно. Если адрес уже известен, можно использовать его. Автоматический выбор города на ЦИАН пока настроен для Кондрово.</p>{['avito','cian'].map(k=><label className="form-field" key={k}>{k==='avito'?'Авито':'ЦИАН'}<input type="url" placeholder="https://…" value={urls[k]} onChange={e=>setURLs({...urls,[k]:e.target.value})}/></label>)}{avitoRestricted&&<><p>Повторную проверку Авито можно запустить отдельно после восстановления доступа к сайту.</p><button className="btn secondary" disabled={running||parcel.demo} onClick={()=>run('avito')}>Проверить доступ Авито отдельно</button></>}</details><button className="btn secondary" disabled={running||parcel.demo} onClick={()=>run(avitoRestricted?'cian':'all')}>{running?(error?'Состояние поиска неизвестно':'Выполняем поиск в браузере…'):avitoRestricted?'Обновить цены ЦИАН':'Получить цены автоматически'}</button></details>{data?.message&&!error&&<p role="status">{data.message}</p>}{error&&<><p role="status">{error}</p><button className="btn secondary" onClick={refresh}>Проверить состояние поиска</button></>}{data?.sources?.map(s=><p key={s.source}><b>{s.source}</b>: {s.message}{s.notRequested&&<span> Сохранённый результат; источник сейчас не запрашивался.</span>}{s.status==='access_check'&&<span> Во вкладке {s.source} выполни предложенную сайтом проверку, затем повтори поиск.</span>}</p>)}{!running&&<MarketOfferSummary summary={summary}/>}{values.length>0&&!running&&<button className="btn secondary" onClick={()=>onUse(values)}>Добавить {values.length} сопоставимых объявлений в расчёт</button>}{data&&<button className="btn secondary" onClick={()=>download(data,'market-source-report.json')}>Скачать отчёт по объявлениям</button>}</div></>;
}
