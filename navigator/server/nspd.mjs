import {createNspdScanner} from './nspd-scan.mjs';
import {captureFeatures,assessObject,PILOT_BOUNDS,BOUNDARY_DISCOVERY_BOUNDS,boxGeometry,interiorSample} from '../src/nspd-geometry.mjs';
import {NSPD_LAYERS,NSPD_PILOT} from '../src/nspd-layers.mjs';
const ORIGIN='https://nspd.gov.ru';
const stamp=()=>new Date().toISOString();
function featureCount(v){const f=v?.features??v?.data?.features;return Array.isArray(f)?f:null;}
export function createNspdService({db,fetchImpl=globalThis.fetch,timeout=10000,clock=()=>Date.now()}){
 db.exec('CREATE TABLE IF NOT EXISTS nspd_observations (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);');
 db.exec('CREATE TABLE IF NOT EXISTS nspd_snapshots (layer_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS nspd_snapshot_history (id INTEGER PRIMARY KEY AUTOINCREMENT,layer_id TEXT NOT NULL,checked_at TEXT NOT NULL,payload TEXT NOT NULL);');
 const read=id=>{const r=db.prepare('SELECT payload FROM nspd_observations WHERE id=?').get(id);return r?JSON.parse(r.payload):null;};
 const write=(id,r)=>db.prepare('INSERT INTO nspd_observations(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(r));

 const snapshots=()=>db.prepare('SELECT payload FROM nspd_snapshots').all().map(r=>JSON.parse(r.payload));
 const saveSnapshot=snapshot=>{const payload=JSON.stringify(snapshot);db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO nspd_snapshots(layer_id,payload) VALUES(?,?) ON CONFLICT(layer_id) DO UPDATE SET payload=excluded.payload').run(snapshot.layerId,payload);db.prepare('INSERT INTO nspd_snapshot_history(layer_id,checked_at,payload) VALUES(?,?,?)').run(snapshot.layerId,snapshot.checkedAt,payload);db.prepare('DELETE FROM nspd_snapshot_history WHERE layer_id=? AND id NOT IN (SELECT id FROM nspd_snapshot_history WHERE layer_id=? ORDER BY id DESC LIMIT 3)').run(snapshot.layerId,snapshot.layerId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};
 const summary=s=>({layerId:s.layerId,categoryId:s.categoryId,checkedAt:s.checkedAt,count:s.count,storedCount:s.objects.length,mappedCount:s.objects.filter(o=>o.geometry).length,inferredCount:s.objects.filter(o=>o.coordinateStatus==='inferred').length,partial:s.partial,scope:s.scope,scopeLabel:s.scopeLabel,territoryId:s.territoryId??null});
 const locks=new Set(),lastCalls=new Map();let scanner=null;
 async function request(path,{method='GET',body,json=true,layer=null,scope=PILOT_BOUNDS,signal}={}){const url=new URL(path,ORIGIN);if(url.origin!==ORIGIN)throw Error('Only NSPD origin allowed');const result={checkedAt:stamp(),url:url.toString(),status:'unavailable',httpStatus:null};try{const response=await fetchImpl(url,{method,headers:{accept:json?'application/json':'text/html',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout),redirect:'error',credentials:'omit'});result.httpStatus=response.status;if(!response.ok)await response.body?.cancel();
 if(response.status===401)return {...result,status:'authorization',message:'Источник требует авторизации. Вход в отдельной вкладке не передаёт сессию программе.'};
 if(response.status===403)return {...result,status:'denied',message:'Источник ограничил запрос. Причина и условия доступа требуют уточнения.'};
 if(response.status===429)return {...result,status:'limited',message:'Лимит запросов источника. Повторим позже.',retryAfter:response.headers.get('retry-after')};
 if(!response.ok)return {...result,message:`Источник вернул HTTP ${response.status}. Это не означает отсутствие объектов.`};
 if(!json){await response.body?.cancel();return {...result,status:'reachable',message:'Страница доступна. Доступ к данным слоёв проверяется отдельно.'};}
 if(Number(response.headers.get('content-length'))>3000000){await response.body?.cancel();return {...result,status:'too_large',message:'Ответ слишком большой. Нужно уменьшить область запроса.'};}
 const reader=response.body?.getReader();let raw='',size=0;const dec=new TextDecoder();if(!reader)return {...result,status:'invalid',message:'Ответ не содержит данных.'};try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>3000000){await reader.cancel();return {...result,status:'too_large',message:'Ответ слишком большой; запрос остановлен.'};}raw+=dec.decode(value,{stream:true});}raw+=dec.decode();}finally{reader.releaseLock();}
 let payload;try{payload=JSON.parse(raw);}catch{return {...result,status:'invalid',message:'Вместо данных получена страница или неподдерживаемый ответ.'};}
 const features=featureCount(payload);if(!features)return {...result,status:'invalid',message:'Формат ответа изменился или источник вернул ошибку. Данные не подтверждены.'};
 const preview=features.slice(0,8).map(f=>({id:String(f.id??f.properties?.id??''),name:String(f.properties?.label??f.properties?.name??f.properties?.options?.readable_address??f.properties?.options?.cad_num??'Объект источника').slice(0,400),geometryType:f.geometry?.type||null}));
 const objects=layer?captureFeatures(features,{layer,checkedAt:result.checkedAt,sourceURL:result.url,crs:payload.crs||payload.data?.crs,scope}):undefined;
 return {...result,...(objects?{objects}:{}),status:'available',geometryCRS:payload.crs?.properties?.name||payload.data?.crs?.properties?.name||null,propertyFields:Object.keys(features[0]?.properties||{}),optionFields:Object.keys(features[0]?.properties?.options||{}),count:features.length,possiblyTruncated:features.length>=100,preview,message:features.length?'Получены реальные сведения источника. Правовая доступность участков не подтверждена.':'Источник ответил пустой выборкой в проверочной области. Это не доказательство отсутствия объектов на всей территории.'};
 }catch(e){const text=String(e?.cause?.message||e?.message||'');if(/cert|certificate|issuer|TLS|SSL/i.test(text))return {...result,status:'certificate',message:'Не удалось проверить сертификат НСПД. Проверка TLS не отключалась; требуется настройка доверенных сертификатов Node.js.'};return {...result,status:e?.name==='TimeoutError'||e?.name==='AbortError'?'timeout':'unavailable',message:'Данные не получены: тайм-аут или ошибка соединения. Это не результат поиска участков.'};}}
 async function limited(id,fn){if(scanner?.isBusy())throw Error('Сначала поставь обход территории на паузу.');if(locks.has(id))throw Error('Этот запрос уже выполняется.');const last=lastCalls.get(id);if(last!=null&&clock()-last<30000)throw Error('Повторить проверку можно через 30 секунд.');locks.add(id);lastCalls.set(id,clock());try{const r=await fn();write(id,r);return r;}finally{locks.delete(id);}}
 const boundaryId='875831';
 function territory(){
  const chosen=read('territory');if(!chosen)return null;
  const snapshot=snapshots().find(s=>s.layerId===boundaryId),last=read('layer:'+boundaryId);
  return {...chosen,usable:snapshot?.version===chosen.boundaryVersion&&last?.status==='available'&&last.checkedAt===snapshot.checkedAt};
 }
 const overview=()=>{
  const layers=NSPD_LAYERS.map(l=>({...l,observation:read('layer:'+l.id)})),saved=snapshots(),boundary=saved.find(s=>s.layerId===boundaryId);
  return {pilot:NSPD_PILOT,report:read('connection'),layers,snapshots:saved.map(summary),territory:territory(),boundaryDiscovery:{scope:BOUNDARY_DISCOVERY_BOUNDS,observation:read('layer:'+boundaryId),version:boundary?.version??null,partial:boundary?.partial??false,choices:(boundary?.objects||[]).map(o=>({id:o.id,name:o.name,attributes:o.attributes,coordinateStatus:o.coordinateStatus,selectable:!!o.geometry&&o.coordinateStatus==='declared'&&o.hasStableSourceId}))},accessSummary:{searchAvailable:!!read('connection')?.results?.some(r=>r.id==='search'&&r.status==='available'),layerDataReceived:layers.some(l=>l.observation?.status==='available'&&l.observation.count>0),successfulCategories:[...new Set(layers.filter(l=>l.observation?.status==='available').map(l=>l.categoryId))].length,savedObjects:saved.reduce((n,s)=>n+s.objects.length,0),message:'Доступность поиска по названию и получение данных слоёв учитываются отдельно.'},credentials:'Не запрашиваются; используются только доступные без сессии ответы источника.'};
 };
 function selectTerritory(id,version){
  if(locks.size||scanner?.isBusy())throw Error('Дождись завершения запроса или поставь обход на паузу.');
  const snapshot=snapshots().find(s=>s.layerId===boundaryId),last=read('layer:'+boundaryId);
  if(!snapshot||snapshot.version!==version||last?.status!=='available'||last.checkedAt!==snapshot.checkedAt)throw Error('Снимок границ изменился или последняя проверка неуспешна. Сначала обнови границы.');
  const object=snapshot.objects.find(o=>o.id===id);
  if(!object?.geometry||object.coordinateStatus!=='declared'||!object.hasStableSourceId)throw Error('Для выбора нужен полигон с указанной источником системой координат и постоянным ID.');
  const sample=interiorSample(object.geometry);
  write('territory',{id:object.id,name:object.attributes.settlement_name||object.attributes.name||object.name,boundaryVersion:snapshot.version,checkedAt:snapshot.checkedAt,geometry:object.geometry,queryGeometry:sample.geometry,scope:sample.scope,selectedAt:stamp()});
  return territory();
 }
 function objects(id){
  if(!NSPD_LAYERS.some(l=>l.id===id))throw Error('Неизвестный слой.');
  const all=snapshots(),snapshot=all.find(s=>s.layerId===id);
  if(!snapshot)return {snapshot:null,objects:[],message:'Снимка ещё нет. Нажми «Загрузить выбранные слои».'};
  const layers=overview().layers,chosen=territory(),observation=read('layer:'+id);
  // A selected town must not be replaced by the union of neighbouring settlements.
  const checksSnapshots=chosen?all.map(s=>s.layerId===boundaryId?{...s,objects:s.objects.filter(o=>o.id===chosen.id)}:s):all;
  return {snapshot:{...summary(snapshot),queryGeometry:snapshot.queryGeometry||boxGeometry(snapshot.scope),sourceURL:snapshot.sourceURL,version:snapshot.version},latestCheck:observation,stale:observation?.status!=='available'||observation?.checkedAt!==snapshot.checkedAt,scopeChanged:id!==boundaryId&&(snapshot.territoryId??null)!==(chosen?.id??null),territory:chosen,objects:snapshot.objects.map(o=>({...o,checks:assessObject(o,checksSnapshots,layers)}))};
 }

 async function probe(){return limited('connection',async()=>{const jobs=[['map','/map',false],['search','/api/geoportal/v2/search/geoportal?query='+encodeURIComponent('Кондрово')+'&thematicSearchId=1',true],['boundary','/api/geoportal/v2/search/geoportal?query='+encodeURIComponent('Кондрово')+'&thematicSearchId=4',true]];const results=await Promise.all(jobs.map(async([id,path,json])=>({id,...await request(path,{json})})));return {checkedAt:stamp(),results,confirmedData:results.some(r=>r.status==='available'),message:'Проверка доступности. Не поиск свободных участков.'};});}
 async function fetchLayer(def,{scope,geometry,label,territoryId=null}){
  return limited('layer:'+def.id,async()=>{
   const body={categories:[{id:def.categoryId}],geom:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{...geometry,crs:{type:'name',properties:{name:'EPSG:4326'}}}}]}};
   const r=await request('/api/geoportal/v1/intersects?typeIntersect=fullObject',{method:'POST',body,layer:def,scope});
   if(r.status==='available')saveSnapshot({version:crypto.randomUUID(),layerId:def.id,categoryId:def.categoryId,checkedAt:r.checkedAt,scope,scopeLabel:label,queryGeometry:geometry,territoryId,sourceURL:r.url,count:r.count,partial:r.possiblyTruncated||r.count>(r.objects?.length||0),objects:r.objects||[]});
   const {objects:storedObjects,...observation}=r;
   return {...observation,layerId:def.id,categoryId:def.categoryId,scope:label,queryBounds:scope,territoryId,categoryShared:NSPD_LAYERS.filter(l=>l.categoryId===def.categoryId).length>1,message:r.message+(NSPD_LAYERS.filter(l=>l.categoryId===def.categoryId).length>1?' Категория общая для нескольких слоёв: отдельный подслой по этому ответу не подтверждён.':'')};
  });
 }
 async function findBoundary(){
  if(locks.size||scanner?.isBusy())throw Error('Дождись завершения запроса или поставь обход на паузу.');
  return fetchLayer(NSPD_LAYERS.find(l=>l.id===boundaryId),{scope:BOUNDARY_DISCOVERY_BOUNDS,geometry:boxGeometry(BOUNDARY_DISCOVERY_BOUNDS),label:'Поиск полигонов населённых пунктов в окрестностях Кондрово, около 13 × 13 км. Прямоугольник не является границей города.'});
 }
 async function layer(id){
  const def=NSPD_LAYERS.find(l=>l.id===id);if(!def)throw Error('Неизвестный слой.');
  const chosen=territory();
  if(id===boundaryId){if(chosen?.usable)return read('layer:'+boundaryId);return findBoundary();}
  if(chosen&&!chosen.usable)throw Error('Выбранная граница требует повторного подтверждения. Обнови границы и выбери полигон.');
  return fetchLayer(def,chosen?{scope:chosen.scope,geometry:chosen.queryGeometry,territoryId:chosen.id,label:`Проверочный фрагмент около 200 × 200 м внутри выбранной границы: ${chosen.name}. Не весь населённый пункт.`}:{scope:PILOT_BOUNDS,geometry:boxGeometry(PILOT_BOUNDS),label:'Проверочная область около 200 × 200 м у центра присланной карты; не весь город.'});
 }
 scanner=createNspdScanner({db,getTerritory:()=>{if(locks.size)throw Error('Дождись завершения текущего запроса.');return territory();},query:(cell,signal)=>request('/api/geoportal/v1/intersects?typeIntersect=fullObject',{method:'POST',body:{categories:[{id:36368}],geom:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{...cell.geometry,crs:{type:'name',properties:{name:'EPSG:4326'}}}}]}},layer:NSPD_LAYERS.find(l=>l.id==='36048'),scope:cell.scope,signal})});
 return {overview,probe,layer,objects,findBoundary,selectTerritory,scanner};
}
