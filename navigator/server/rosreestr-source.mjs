const CATALOG='https://rosreestr.gov.ru/data-sets/';
const HOSTS=new Set(['rosreestr.gov.ru','www.rosreestr.gov.ru']);
export const ROSREESTR_CATALOG=CATALOG;
function officialURL(value,base=CATALOG){const u=new URL(value,base);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password||u.port)throw Error('Разрешены только HTTPS-файлы официального Росреестра.');u.hash='';return u;}
const entities=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
export function discoverDealFiles(html){
 const files=[],seen=new Set();
 for(const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)){
  try{const url=officialURL(entities(m[1]));let decoded;try{decoded=decodeURIComponent(url.pathname)}catch{continue}const title=entities(m[2].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,300),name=decoded.split('/').at(-1);
   if(!/\.csv$/i.test(name)||!/(сделк|deal)/i.test(name+' '+title)||seen.has(url.href))continue;
   seen.add(url.href);const period=name.match(/(?:^|_)y_(20\d{2})_q_([1-4])(?:\D|$)/i);files.push({id:url.href,url:url.href,name,title,period:period?`${period[1]}-Q${period[2]}`:null});
  }catch{/* External links, scripts and unrelated datasets are never fetched. */}
 }
 return files.sort((a,b)=>(b.period||'').localeCompare(a.period||'')||a.name.localeCompare(b.name)).slice(0,40);
}
export function csvPreview(bytes){
 let encoding='utf-8',text;
 if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
 try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes,{stream:true})}catch{encoding='windows-1251';text=new TextDecoder(encoding).decode(bytes)}
 text=text.replace(/^\uFEFF/,'');if(/^\s*</.test(text))throw Error('Вместо CSV получена HTML-страница. Цены не загружены.');
 function parse(delimiter){const records=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length&&records.length<9;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
   else if(!quoted&&c===delimiter){row.push(field);field='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))records.push(row);row=[];field='';}
   else field+=c;
  }
  // The byte prefix can end mid-record; only complete lines are shown.
  return records;
 }
 const candidates=[';',',','\t'].map(delimiter=>({delimiter,records:parse(delimiter)})).sort((a,b)=>(b.records[0]?.length||0)-(a.records[0]?.length||0)),best=candidates[0];
 if((best.records[0]?.length||0)<3)throw Error('Структура CSV не распознана. Цены не загружены.');
 const headers=best.records[0].map(s=>s.trim().slice(0,300));if(headers.length>80)throw Error('Неожиданно много полей в выгрузке.');
 const rows=best.records.slice(1).filter(row=>row.length===headers.length).map(row=>row.map(v=>v.slice(0,1000)));
 return {encoding,delimiter:best.delimiter,headers,rows,schemaStatus:'unverified',calculationImport:false};
}
export function createRosreestrSource({db,fetchImpl=globalThis.fetch,clock=()=>Date.now(),timeout=12000}){
 db.exec('CREATE TABLE IF NOT EXISTS rosreestr_source_state(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);');let busy=false,lastCall=null;
 const read=()=>{const r=db.prepare('SELECT payload FROM rosreestr_source_state WHERE id=1').get();return r?JSON.parse(r.payload):null};
 const save=d=>db.prepare('INSERT INTO rosreestr_source_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(d));
 function status(){return {...read(),busy,catalogURL:CATALOG,connected:false,notice:'Образец официальной выгрузки ещё не является подключёнными сделками для расчёта. Личные сведения и Telegram не запрашиваются.'};}
 async function fetchOfficial(url,{prefix=false}={}){
  let target=officialURL(url);const signal=AbortSignal.timeout(timeout);
  for(let hop=0;hop<4;hop++){
   const response=await fetchImpl(target,{headers:{accept:prefix?'text/csv,application/octet-stream;q=0.8':'text/html',...(prefix?{range:'bytes=0-65535'}:{})},credentials:'omit',redirect:'manual',signal});
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Источник перенаправил запрос без адреса.');target=officialURL(location,target);continue;}
   const base={url:target.href,httpStatus:response.status};
   if(!response.ok){await response.body?.cancel();return {...base,status:response.status===403?'denied':response.status===429?'limited':'unavailable',retryAfter:response.headers.get('retry-after'),message:`Росреестр вернул HTTP ${response.status}. Данные о сделках не получены.`};}
   const limit=prefix?65536:3000000,reader=response.body?.getReader();if(!reader)throw Error('Источник вернул пустой ответ.');const chunks=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;const take=prefix?value.subarray(0,Math.max(0,limit-size)):value;size+=take.length;if(size>limit){await reader.cancel();throw Error('Страница каталога слишком велика.');}chunks.push(take);if(prefix&&size>=limit){await reader.cancel();break;}}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return {...base,status:'available',bytes,contentType:response.headers.get('content-type')||''};
  }
  throw Error('Слишком много перенаправлений официального источника.');
 }
 async function probe(){
  if(busy)throw Error('Проверка источника уже идёт.');if(lastCall!==null&&clock()-lastCall<30000)throw Error('Повторить проверку можно через 30 секунд.');const previous=read();if(previous?.retryAt&&clock()<previous.retryAt)throw Error('Источник попросил подождать до '+new Date(previous.retryAt).toLocaleString('ru-RU'));
  busy=true;lastCall=clock();const checkedAt=new Date(clock()).toISOString();let attempt;
  try{const catalog=await fetchOfficial(CATALOG);attempt={checkedAt,status:catalog.status,httpStatus:catalog.httpStatus,catalogURL:CATALOG,files:[],message:catalog.message};
   if(catalog.status==='available'){
    const html=new TextDecoder().decode(catalog.bytes),files=discoverDealFiles(html);attempt.files=files;
    if(!files.length){attempt.status='schema_unknown';attempt.message='Каталог открылся, но ссылки на CSV сделок не распознаны. Нужна проверка формата источника.';}
    else {const sample=await fetchOfficial(files[0].url,{prefix:true});attempt.sampleHTTP=sample.httpStatus;
     if(sample.status==='available'){attempt.sample={file:files[0],...csvPreview(sample.bytes)};attempt.status='sample_received';attempt.message='Получен образец CSV Росреестра. Назначение столбцов и правила отбора ещё нужно подтвердить; цены не добавлены в расчёт.';}
     else {attempt.status=sample.status;attempt.message=sample.message;attempt.retryAfter=sample.retryAfter;}
    }
   }else attempt.retryAfter=catalog.retryAfter;
  }catch(e){attempt={...attempt,checkedAt,catalogURL:CATALOG,status:e.name==='TimeoutError'?'timeout':'unavailable',message:e.name==='TimeoutError'?'Росреестр не ответил вовремя. Получение сделок пока недоступно.':'Не удалось получить и распознать официальный файл: '+e.message,files:attempt?.files||[]};}
  finally{busy=false;}
  if(attempt.status==='limited'){const sec=Number(attempt.retryAfter),date=Date.parse(attempt.retryAfter||'');attempt.retryAt=Math.max(clock()+30000,sec>0?clock()+sec*1000:Number.isFinite(date)?date:clock()+60000);}
  const next={lastAttempt:attempt,lastSample:attempt.sample?{checkedAt,sample:attempt.sample}:previous?.lastSample||null,retryAt:attempt.retryAt||null};save(next);return status();
 }
 return {status,probe};
}
