import {searchAvito} from './market-avito.mjs';
import {searchCian} from './market-cian.mjs';
export function createMarketService({db,avito=searchAvito,cian=searchCian,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS market_sources(parcel_id TEXT PRIMARY KEY,payload TEXT NOT NULL)');const active=new Set();
 const status=id=>{const r=db.prepare('SELECT payload FROM market_sources WHERE parcel_id=?').get(id);return r?JSON.parse(r.payload):null};
 async function search(parcel,urls={}){
  if(!parcel?.id||!parcel.settlement)throw Error('Выбери сохранённый участок.');if(active.has(parcel.id))throw Error('Получение цен уже идёт.');const old=status(parcel.id);if(old&&clock()-Date.parse(old.checkedAt)<30000)throw Error('Повторная проверка доступна через 30 секунд.');
  const retry=Math.max(0,...(old?.sources||[]).map(s=>Number(s.retryAt)||0));if(clock()<retry)throw Error('Источник попросил подождать перед новым запросом.');
  active.add(parcel.id);try{const input={settlement:parcel.settlement,region:parcel.region,usage:parcel.usage,areaMinM2:600,areaMaxM2:2000,limit:25,center:{lat:parcel.lat,lng:parcel.lng}};
   const results=await Promise.allSettled([avito({...input,searchURL:urls.avito||undefined}),cian({...input,searchURL:urls.cian||undefined})]);
   const sources=results.map((r,i)=>r.status==='fulfilled'?r.value:{source:i?'ЦИАН':'Авито',status:'unavailable',connected:false,listings:[],message:'Источник не ответил: '+r.reason?.message});
   const result={parcelId:parcel.id,checkedAt:new Date(clock()).toISOString(),settlement:parcel.settlement,sources,notice:'Цены объявлений. Автоматическое расширение радиуса без подтверждённых страниц пока недоступно.'};db.prepare('INSERT INTO market_sources VALUES(?,?) ON CONFLICT(parcel_id) DO UPDATE SET payload=excluded.payload').run(parcel.id,JSON.stringify(result));return result;
  }finally{active.delete(parcel.id)}
 }
 return {status,search};
}
