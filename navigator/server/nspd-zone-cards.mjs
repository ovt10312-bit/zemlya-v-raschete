const registry=value=>String(value??'').trim();
const validRegistry=value=>/^\d{2}:\d{2}-[67]\.\d+$/.test(value);
export const ZONE_CARD_FIELDS=['reg_numb_border','brd_nmb','name','name_by_doc','description','type_zone','code','zone_code','name_zone','zone_name','index','name_district','name_locality','legal_act_document_issuer','legal_act_document_name','legal_act_document_type','legal_act_document_number','legal_act_document_date','document_name','document_number','document_date','document_issuer','registration_date','start_date','end_date','valid_from','valid_to'];
const primitive=v=>typeof v==='string'?v.slice(0,5000):typeof v==='number'&&Number.isFinite(v)?v:typeof v==='boolean'?v:null;
export function captureZoneRecords(features){return features.slice(0,100).map(f=>{const p=f.properties||{},o=p.options||{};return {id:String(f.id??p.id??'').slice(0,200),label:String(p.label??'').slice(0,500),description:String(p.descr??'').slice(0,5000),categoryName:String(p.categoryName??'').slice(0,500),attributes:Object.fromEntries(ZONE_CARD_FIELDS.filter(k=>primitive(o[k])!==null).map(k=>[k,primitive(o[k])]))};});}
export function createNspdZoneCards({db,query,clock=()=>Date.now()}){
 db.exec('CREATE TABLE IF NOT EXISTS nspd_zone_cards(zone_key TEXT PRIMARY KEY,payload TEXT NOT NULL);');let retryAt=0;
 for(const row of db.prepare('SELECT payload FROM nspd_zone_cards').all()){const state=JSON.parse(row.payload);retryAt=Math.max(retryAt,Number(state.lastAttempt?.retryAt)||0);}
 const read=key=>{const r=db.prepare('SELECT payload FROM nspd_zone_cards WHERE zone_key=?').get(key);return r?JSON.parse(r.payload):null;};
 function targets(reviewId){const source=reviewId?db.prepare('SELECT payload FROM nspd_review_runs WHERE id=?').get(reviewId):db.prepare('SELECT payload FROM nspd_review_runs ORDER BY rowid DESC LIMIT 1').get();if(!source)throw Error('Нет сохранённых проверок участков.');const job=JSON.parse(source.payload),map=new Map();const rows=db.prepare('SELECT parcel_id,payload FROM nspd_review_checks WHERE run_id=?').all(job.id);let incompleteEvidence=false;
  for(const row of rows){const c=JSON.parse(row.payload);if(!['zoning','restrictions'].includes(c.key))continue;if(c.evidenceLimited)incompleteEvidence=true;
   for(const m of c.matches||[]){const number=registry(m.attributes?.reg_numb_border||m.attributes?.brd_nmb||m.name);if(!validRegistry(number))continue;const expected=c.key==='zoning'?'7':'6';if(number.split('-')[1].split('.')[0]!==expected)continue;
    const key=c.key+':'+number;if(!map.has(key))map.set(key,{key,registry:number,kind:c.key,themeId:c.key==='zoning'?7:5,name:c.key==='zoning'?'Территориальная зона':'Охранная зона',sourceId:m.id,sourceCheckedAt:c.checkedAt,parcels:[]});const t=map.get(key);const p=job.parcels.find(p=>p.id===row.parcel_id);if(p&&!t.parcels.includes(p.name))t.parcels.push(p.name);
   }
  }
  const list=[...map.values()].sort((a,b)=>(a.kind==='zoning'?0:1)-(b.kind==='zoning'?0:1)||a.registry.localeCompare(b.registry));
  return {reviewId:job.id,territory:job.territory,incompleteEvidence,targets:list.map(t=>{const state=read(t.key);return {...t,state,stale:!!state?.lastSuccess&&state.lastAttempt.checkedAt!==state.lastSuccess.checkedAt};}),retryAt,notice:'Карточка источника не подтверждает действующую редакцию ПЗЗ, содержание всех ограничений или отсутствие аренды.'};
 }
 async function fetchCard(reviewId,key){const plan=targets(reviewId),target=plan.targets.find(t=>t.key===key);if(!target)throw Error('Зона не найдена среди сохранённых совпадений.');if(clock()<retryAt)throw Error('Источник попросил подождать до '+new Date(retryAt).toLocaleString('ru-RU'));
  const r=await query(target);let result={checkedAt:r.checkedAt,url:r.url,httpStatus:r.httpStatus??null,status:r.status,sourceStatus:r.status,message:r.message,records:[],legalAvailability:'unknown',regulationCurrent:false};
  if(r.status==='available'){
   const exact=(r.records||[]).filter(o=>{const explicit=[o.attributes.reg_numb_border,o.attributes.brd_nmb].filter(v=>registry(v));return explicit.length?explicit.every(v=>registry(v)===target.registry):[o.label,o.description].some(v=>registry(v)===target.registry);});
   const hasDetails=exact.some(o=>Object.keys(o.attributes).some(k=>!['reg_numb_border','brd_nmb'].includes(k))||(o.description&&o.description!==target.registry));
   result={...result,status:exact.length?(hasDetails?'available':'limited_data'):'no_match',count:r.count,possiblyTruncated:!!r.possiblyTruncated,ambiguous:exact.length>1,records:exact.slice(0,6),message:exact.length?(hasDetails?'Получены сведения карточки источника. Актуальность документов и регламента требует проверки.':'Источник вернул только номер или общие сведения зоны. Название и регламент не подтверждены.'):'Точная карточка с этим реестровым номером не найдена. Это не означает отсутствие зоны.'};
  }
  if(r.status==='limited'){const seconds=Number(r.retryAfter),date=Date.parse(r.retryAfter||'');retryAt=Math.max(clock()+30000,Number.isFinite(seconds)&&seconds>0?clock()+seconds*1000:Number.isFinite(date)?date:clock()+60000);result.retryAt=retryAt;}
  const previous=read(key);const state={lastAttempt:result,lastSuccess:['available','limited_data'].includes(result.status)?result:previous?.lastSuccess||null};
  db.prepare('INSERT INTO nspd_zone_cards(zone_key,payload) VALUES(?,?) ON CONFLICT(zone_key) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(state));return targets(plan.reviewId);
 }
 return {targets,fetchCard};
}
