import {searchAvito,extractAvitoCards} from './market-avito.mjs';
import {searchCian} from './market-cian.mjs';
import {describeMarketAccess} from '../src/market-access.mjs';
export function createMarketService({db,avito=searchAvito,cian=searchCian,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS market_sources(parcel_id TEXT PRIMARY KEY,payload TEXT NOT NULL)');const active=new Set();
 const save=result=>{db.prepare('INSERT INTO market_sources VALUES(?,?) ON CONFLICT(parcel_id) DO UPDATE SET payload=excluded.payload').run(result.parcelId,JSON.stringify(result));return result};
 const status=id=>{const r=db.prepare('SELECT payload FROM market_sources WHERE parcel_id=?').get(id);if(!r)return null;const value=JSON.parse(r.payload);return {...value,sources:(value.sources||[]).map(describeMarketAccess)}};
 // A restarted server cannot resume an old browser operation. Preserve prices,
 // mark the interruption explicitly and allow a deliberate new start.
 for(const row of db.prepare('SELECT payload FROM market_sources').all()){
  const result=JSON.parse(row.payload);if(result.jobStatus==='running')save({...result,jobStatus:'interrupted',message:'Предыдущий поиск прерван перезапуском. Можно запустить его снова.'});
 }
 function check(parcel){
  if(!parcel?.id||!parcel.settlement)throw Error('Выбери сохранённый участок.');
  if(active.has(parcel.id))throw Error('Получение цен уже идёт.');
  const old=status(parcel.id);if(old?.jobStatus!=='interrupted'&&old?.checkedAt&&clock()-Date.parse(old.checkedAt)<30000)throw Error('Повторная проверка доступна через 30 секунд.');
  const retry=Math.max(0,...(old?.sources||[]).map(s=>typeof s.retryAt==='number'?s.retryAt:Date.parse(s.retryAt)||0));if(clock()<retry)throw Error('Источник попросил подождать перед новым запросом.');
  return old;
 }
 async function search(parcel,urls={}){
  if(urls.source&&!['all','avito','cian'].includes(urls.source))throw Error('Неизвестный источник объявлений.');
  const old=check(parcel);active.add(parcel.id);
  const running=save({...old,parcelId:parcel.id,settlement:parcel.settlement,startedAt:new Date(clock()).toISOString(),jobStatus:'running',message:'Получаем цены в отдельном окне браузера.',sources:old?.sources||[]});
  try{
   const input={settlement:parcel.settlement,region:parcel.region,usage:parcel.usage,areaMinM2:0,areaMaxM2:Number.MAX_SAFE_INTEGER,limit:25,center:{lat:parcel.lat,lng:parcel.lng}};
   const providers=[{key:'avito',name:'Авито',run:avito},{key:'cian',name:'ЦИАН',run:cian}].filter(p=>!urls.source||urls.source==='all'||urls.source===p.key);
   const results=await Promise.allSettled(providers.map(p=>Promise.resolve().then(()=>p.run({...input,searchURL:urls[p.key]||undefined}))));
   const updated=results.map((r,i)=>r.status==='fulfilled'?describeMarketAccess(r.value):{source:providers[i].name,status:'unavailable',connected:false,listings:[],message:'Источник не ответил: '+r.reason?.message});
   const sources=['Авито','ЦИАН'].flatMap(name=>{const fresh=updated.find(s=>s.source===name),saved=old?.sources?.find(s=>s.source===name);return fresh?[fresh]:saved?[{...saved,notRequested:true}]:[]});
   return save({parcelId:parcel.id,checkedAt:new Date(clock()).toISOString(),settlement:parcel.settlement,jobStatus:'completed',requestedSources:providers.map(p=>p.name),sources,notice:'Цены объявлений. Автоматическое расширение радиуса без подтверждённых страниц пока недоступно.'});
  }catch(e){save({...running,jobStatus:'failed',checkedAt:new Date(clock()).toISOString(),message:'Не удалось сохранить результат поиска.'});throw e}
  finally{active.delete(parcel.id)}
 }
 function start(parcel,urls={}){
  // Validate synchronously so HTTP can return real errors. The long browser
  // operation runs in the background; GET only reads its persisted state.
  if(urls.source&&!['all','avito','cian'].includes(urls.source))throw Error('Неизвестный источник объявлений.');check(parcel);search(parcel,urls).catch(()=>{});return status(parcel.id);
 }
 function importBrowser(parcel,payload){
  // Submitting already read cards performs no network request. A fresh Cian
  // result must not prevent this submission through the network cooldown.
  if(!parcel?.id||!parcel.settlement)throw Error('Выбери сохранённый участок.');
  if(active.has(parcel.id))throw Error('Дождись завершения текущего поиска.');
  const old=status(parcel.id);
  if(!payload||!Array.isArray(payload.cards)||payload.cards.length>25||JSON.stringify(payload).length>150000)throw Error('Некорректный ответ расширения.');
  const checkedAt=new Date(clock()).toISOString();let listings=[],rejected={};
  if(payload.status==='completed'){
   const u=new URL(payload.searchURL);if(u.protocol!=='https:'||!['avito.ru','www.avito.ru'].includes(u.hostname)||u.port||u.username||u.password||!u.pathname.includes('/zemelnye_uchastki'))throw Error('Расширение не подтвердило публичную выдачу Авито.');
   const words=(text,value)=>{const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean);const a=norm(text),b=norm(value);return b.length>0&&a.some((_,i)=>b.every((v,j)=>a[i+j]===v));};
   const cards=payload.cards.map(card=>{
    const location=typeof card.location==='string'?card.location:'';
    const local=words(location,parcel.settlement)&&! /\d+\s*км/iu.test(location);
    const regional=words(location,parcel.region)||payload.locationSelected===true;
    return {title:String(card.title||'').slice(0,500),url:String(card.url||'').slice(0,2000),price:card.price,currency:card.currency,usageText:String(card.usageText||'').slice(0,4000),address:local&&regional?{addressLocality:parcel.settlement,addressRegion:parcel.region}:{}};
   });
   ({listings,rejected}=extractAvitoCards(cards,{settlement:parcel.settlement,region:parcel.region,usage:parcel.usage,limit:25},{checkedAt,baseURL:u.href}));
   listings=listings.map(row=>({...row,collectionMethod:'browser_extension'}));
  }
  const statuses=new Set(['denied','access_check','timeout','schema_unknown','automation_failed','invalid_request','busy']);
  const source={source:'Авито',checkedAt,listings,rejected,connected:listings.length>0,transport:'browser_extension',status:listings.length?'available':statuses.has(payload.status)?payload.status:'schema_unknown',message:listings.length?`Получены цены Авито: ${listings.length}. Это цены объявлений.`:String(payload.message||'Не найдены карточки с подтверждёнными ценой, площадью, назначением и местом.').slice(0,500)};
  const sources=[source,...(old?.sources||[]).filter(s=>s.source!=='Авито').map(s=>({...s,notRequested:true}))];
  return save({parcelId:parcel.id,settlement:parcel.settlement,checkedAt,jobStatus:'completed',requestedSources:['Авито'],sources});
 }
 return {status,search,start,importBrowser};
}
