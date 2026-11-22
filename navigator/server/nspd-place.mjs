import {REGIONS} from '../src/domain.mjs';
import {geometryWithin} from '../src/nspd-geometry.mjs';
export const WORLD_BOUNDS={west:-180,east:180,south:-85,north:85};
const cadPattern=/^\d{2}:\d{2}:\d+:\d+$/;
const norm=v=>String(v||'').toLowerCase().replace(/ё/g,'е').replace(/^(?:г\.?|город|д\.?|деревня|с\.?|село|пос\.?|поселок)\s+/,'').replace(/\s+/g,' ').trim();
const regionCodes={'40':0,'71':1,'47':2,'66':3,'72':4,'74':5,'69':6,'33':7,'02':8};
function locationFor(territory,extra={}){
 const registry=territory.attributes?.brd_nmb||territory.attributes?.reg_numb_border||territory.name||'';
 // Pilot label confirmed by the user against the displayed boundary, not inferred from proximity.
 const pilot=String(territory.id)==='2170917361'&&registry==='40:04-4.260';
 const settlement=territory.attributes?.settlement_name||territory.attributes?.name||(pilot?'Кондрово':territory.name)||registry;
 const code=String(extra.referenceCadastre||registry).slice(0,2),region=REGIONS[regionCodes[code]]||REGIONS.find(r=>String(territory.attributes?.readable_address||'').includes(r))||'';
 return {id:String(territory.id),settlement,region,registry,geometry:territory.geometry,checkedAt:territory.checkedAt||extra.checkedAt||null,sourceURL:territory.sourceURL||extra.sourceURL||null,...extra};
}
export function createNspdPlace({db,query}){
 function cached(queryText){
  const isCad=cadPattern.test(queryText),all=db.prepare('SELECT payload FROM nspd_scan_runs ORDER BY rowid DESC LIMIT 30').all().map(r=>JSON.parse(r.payload)).sort((a,b)=>(b.status==='completed')-(a.status==='completed')),places=[];
  for(const scan of all){if(!scan.territory?.geometry)continue;
   const t=scan.territory,loc=locationFor({...t,checkedAt:scan.updatedAt});
   if(places.some(p=>p.id===loc.id))continue;
   if(isCad){const rows=db.prepare("SELECT payload FROM nspd_scan_objects WHERE run_id=? AND (json_extract(payload,'$.attributes.cad_num')=? OR json_extract(payload,'$.name')=?)").all(scan.id,queryText,queryText);const objects=rows.map(r=>JSON.parse(r.payload)).filter(o=>(!o.attributes?.cad_num||String(o.attributes.cad_num).trim()===queryText)&&o.coordinateStatus==='declared'&&o.geometry&&geometryWithin(o.geometry,[t.geometry])===true);if(!objects.length)continue;loc.referenceCadastre=queryText;}
   else if(![loc.settlement,loc.settlement+', '+loc.region,loc.settlement+' '+loc.region].some(name=>norm(name)===norm(queryText)))continue;
   places.push({...loc,scanId:scan.status==='completed'?scan.id:null,cached:true});
  }
  return places;
 }
 async function resolve(text){
  const queryText=String(text??'').trim();if(!queryText||queryText.length>200)throw Error('Введи название населённого пункта или кадастровый номер.');
  if(/^[\d:.\s-]+$/.test(queryText)&&!cadPattern.test(queryText))throw Error('Проверь кадастровый номер. Пример: 40:04:010802:1006.');
  const saved=cached(queryText);if(saved.length)return {status:'available',choices:saved};
  const isCad=cadPattern.test(queryText),r=await query('search',{query:queryText,theme:isCad?1:4});
  if(r.status!=='available')return {status:'unavailable',sourceStatus:r.status,httpStatus:r.httpStatus,retryAfter:r.retryAfter,message:r.status==='denied'?'НСПД ограничил поиск этого места. Сохранённых данных для него нет. Поиск вариантов не выполнен.':r.message||'Не удалось определить место. Попробуй позже.'};
  let objects=r.objects||[],ref=null;
  if(isCad){const matches=objects.filter(o=>{const numbers=[o.attributes?.cad_num,o.attributes?.cad_number].filter(Boolean);return numbers.length?numbers.every(n=>String(n).trim()===queryText):String(o.name).trim()===queryText});if(matches.length!==1||!matches[0].geometry||matches[0].coordinateStatus!=='declared')return {status:'unavailable',message:'Источник не передал единственный точный контур по этому кадастровому номеру. Населённый пункт не определён.'};ref=matches[0];const boundaries=await query('settlements',{geometry:ref.geometry});if(boundaries.status!=='available')return {status:'unavailable',sourceStatus:boundaries.status,httpStatus:boundaries.httpStatus,retryAfter:boundaries.retryAfter,message:'Не удалось получить границу населённого пункта для этого кадастрового номера. Поиск вариантов не выполнен.'};objects=boundaries.objects||[];}
  const requestedRegion=REGIONS.find(r=>norm(queryText).includes(norm(r)));
  const choices=objects.filter(o=>o.geometry&&o.coordinateStatus==='declared'&&o.hasStableSourceId&&(!ref||geometryWithin(ref.geometry,[o.geometry])===true)).map(o=>locationFor(o,{...(ref?{referenceCadastre:queryText}:{})})).filter(l=>(ref||norm(l.settlement)===norm(queryText.split(',')[0]))&&(!requestedRegion||l.region===requestedRegion)).filter((l,i,a)=>a.findIndex(x=>x.id===l.id)===i).slice(0,20);
  return choices.length?{status:'available',choices}:{status:'unavailable',message:'Не получена подходящая граница населённого пункта. Это не означает, что в нём нет мест для образования участков.'};
 }
 return {resolve,cached};
}
