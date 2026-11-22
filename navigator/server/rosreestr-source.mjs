const CATALOG='https://rosreestr.gov.ru/data-sets/';
const HOSTS=new Set(['rosreestr.gov.ru','www.rosreestr.gov.ru']);
export const ROSREESTR_CATALOG=CATALOG;
function officialURL(value,base=CATALOG){const u=new URL(value,base);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password||u.port)throw Error('Разрешены только HTTPS-файлы официального Росреестра.');u.hash='';return u;}
// Decode names for matching only; always request the original published URL.
function decodePathName(value){return value.replace(/(?:%[0-9a-f]{2})+/gi,part=>{const bytes=Uint8Array.from(part.match(/[0-9a-f]{2}/gi),h=>parseInt(h,16));try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return new TextDecoder('windows-1251').decode(bytes)}});}
function decodeCatalog(bytes,contentType=''){
 const hint=contentType+' '+new TextDecoder('latin1').decode(bytes.subarray(0,4096));
 if(/charset\s*=\s*["']?(?:windows-1251|cp1251)/i.test(hint))return new TextDecoder('windows-1251').decode(bytes);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return new TextDecoder('windows-1251').decode(bytes)}
}
const entities=s=>s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):''});
const plain=s=>entities(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function catalogLinks(html){
 const links=[],document=html.replace(/<!--[\s\S]*?-->/g,''),markup=document.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
 for(const m of markup.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi))links.push({value:entities(m[1]||m[2]),title:plain(m[3]).slice(0,300)});
 for(const m of markup.matchAll(/\bdata-(?:href|url|download)\s*=\s*["']([^"']+)["']/gi))links.push({value:entities(m[1]),title:''});
 // Read only declarative JSON. Never execute page scripts or fetch JS endpoints.
 for(const m of document.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
  try{let visited=0;function visit(v,depth=0){if(++visited>30000||depth>20)return;if(typeof v==='string'){if(/\.csv(?:[?#]|$)/i.test(v))links.push({value:v,title:''})}else if(v&&typeof v==='object')for(const x of Object.values(v))visit(x,depth+1)}visit(JSON.parse(m[1]));}catch{/* Unknown JSON is not interpreted as code. */}
 }
 return links;
}
export function discoverDealFiles(html,base=CATALOG){
 const files=[],seen=new Set();
 for(const link of catalogLinks(html)){
  try{const url=officialURL(link.value,base);const decoded=decodePathName(url.pathname);const title=link.title,name=decoded.split('/').at(-1);
   if(!/\.csv$/i.test(name)||!/(сделк|sdelk|deal)/i.test(name+' '+title)||seen.has(url.href))continue;
   seen.add(url.href);const period=name.match(/(?:^|_)y_(20\d{2})_q_([1-4])(?:\D|$)/i);files.push({id:url.href,url:url.href,name,title,period:period?`${period[1]}-Q${period[2]}`:null});
  }catch{/* External links, scripts and unrelated datasets are never fetched. */}
 }
 return files.sort((a,b)=>(b.period||'').localeCompare(a.period||'')||a.name.localeCompare(b.name)).slice(0,40);
}
export function transactionWindow(now){
 const end=new Date(now),start=new Date(now);start.setUTCFullYear(start.getUTCFullYear()-1);
 return {from:start.toISOString(),to:end.toISOString(),months:12};
}
function quarterRange(period){const m=period?.match(/^(20\d{2})-Q([1-4])$/);if(!m)return null;const year=Number(m[1]),quarter=Number(m[2]);return {from:Date.UTC(year,(quarter-1)*3,1),to:Date.UTC(year,quarter*3,1)};}
function overlapsWindow(period,window){const q=quarterRange(period);return q&&q.from<=Date.parse(window.to)&&q.to>Date.parse(window.from);}
function partialPeriod(period,window){const q=quarterRange(period);return q? q.from<Date.parse(window.from)||q.to>Date.parse(window.to):null;}
export function discoverQuarterFolders(html,base=CATALOG,window=transactionWindow(Date.now())){
 const found=new Map(),parent=officialURL(base);
 for(const link of catalogLinks(html)){
  try{const url=officialURL(link.value,parent);if(url.search||!url.pathname.startsWith(parent.pathname)||!url.pathname.endsWith('/'))continue;
   const relative=url.pathname.slice(parent.pathname.length);if(!relative||relative.slice(0,-1).includes('/'))continue;
   const name=decodePathName(relative.slice(0,-1)),text=name.replace(/_/g,' '),m=text.match(/^([1-4])\s*квартал\s*(20\d{2})(?:\D|$)/i);if(!m)continue;
   const period=`${m[2]}-Q${m[1]}`;if(!overlapsWindow(period,window))continue;
   const version=Number(text.match(/верси[яи]\s*(\d+)/i)?.[1]||1),entry={url:url.href,name,period,version,partialPeriod:partialPeriod(period,window)};
   if(!found.has(period)||version>found.get(period).version)found.set(period,entry);
  }catch{/* Follow only published direct quarterly folders on the official host. */}
 }
 return [...found.values()].sort((a,b)=>b.period.localeCompare(a.period)).slice(0,5);
}
export function inspectCatalogResponse(html,contentType='',byteLength=0,base=CATALOG){
 const title=plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]||'').slice(0,200);
 const visible=plain(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''));
 const accessCheck=/(captcha|access denied|доступ запрещ|проверка (?:браузера|доступа)|проверку безопасности|подтвердите.{0,30}(?:робот|человек)|checking your browser|verify you are human|just a moment)/i.test(title+' '+visible);
 const javascriptRequired=/(enable javascript|включите javascript|необходимо включить javascript)/i.test(visible);
 const links=catalogLinks(html),fileNames=[],publishedLinks=[];
 for(const link of links){try{const u=officialURL(link.value,base),name=decodePathName(u.pathname).split('/').at(-1);if(u.pathname.startsWith('/data-sets/')&&publishedLinks.length<24)publishedLinks.push({href:(u.origin+u.pathname).slice(0,1200),title:link.title,name:decodePathName(u.pathname).slice(0,300)});if(/\.(csv|zip|xlsx?|pdf|docx?)$/i.test(name)&&!fileNames.includes(name)&&fileNames.length<20)fileNames.push(name.slice(0,200));}catch{}}
 return {title,contentType:contentType.slice(0,120),byteLength,linkCount:links.length,scriptCount:[...html.matchAll(/<script\b/gi)].length,accessCheck,javascriptRequired,fileNames,publishedLinks};
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
  try{const catalog=await fetchOfficial(CATALOG);const window=transactionWindow(clock());attempt={checkedAt,status:catalog.status,httpStatus:catalog.httpStatus,catalogURL:CATALOG,window,folders:[],files:[],samples:[],message:catalog.message};
   if(catalog.status==='available'){
    const html=decodeCatalog(catalog.bytes,catalog.contentType),page=inspectCatalogResponse(html,catalog.contentType,catalog.bytes.length,catalog.url);attempt.page=page;
    if(page.accessCheck){attempt.status='access_check';attempt.message='Вместо файлов получена страница проверки доступа. Сделки не загружены.';}
    else {
     const addFiles=(content,base,folder)=>{for(const file of discoverDealFiles(content,base)){
      // Folder period is provenance, not an invented exact transaction date.
      const period=file.period||folder?.period;if(period&&!overlapsWindow(period,window))continue;
      if(!attempt.files.some(f=>f.url===file.url))attempt.files.push({...file,catalogPeriod:folder?.period||null,partialPeriod:partialPeriod(period,window)});
     }};
     addFiles(html,catalog.url);
     const folders=discoverQuarterFolders(html,catalog.url,window);
     for(const folder of folders){
      const result=await fetchOfficial(folder.url),record={...folder,httpStatus:result.httpStatus,status:result.status};attempt.folders.push(record);
      if(result.status!=='available'){attempt.status=result.status;attempt.message=result.message;attempt.retryAfter=result.retryAfter;break;}
      const content=decodeCatalog(result.bytes,result.contentType);record.page=inspectCatalogResponse(content,result.contentType,result.bytes.length,result.url);
      if(record.page.accessCheck){record.status='access_check';attempt.status='access_check';attempt.message='Папка периода вернула страницу проверки доступа. Сделки не загружены.';break;}
      const before=attempt.files.length;addFiles(content,result.url,folder);record.fileCount=attempt.files.length-before;
     }
     if(attempt.status==='available'){
      attempt.files.sort((a,b)=>(b.period||b.catalogPeriod||'').localeCompare(a.period||a.catalogPeriod||'')||a.name.localeCompare(b.name));
      if(!attempt.files.length){attempt.status='schema_unknown';attempt.message=page.javascriptRequired?'Для страницы требуется JavaScript. Ссылки на файлы в полученном ответе отсутствуют; сделки не загружены.':folders.length?'Папки за последние 12 месяцев открыты, но CSV сделок внутри не распознаны. Это не означает отсутствие сделок.':'Сервер ответил, но ссылки на CSV сделок за последние 12 месяцев не найдены. Доступ к каталогу и формат ответа пока не подтверждены; это не означает отсутствие сделок.';}
      else {
       // At most one bounded preview per published quarter; no full-country download.
       const seen=new Set(),selected=attempt.files.filter(f=>{const key=f.period||f.catalogPeriod||'unknown';if(seen.has(key))return false;seen.add(key);return true}).slice(0,5);
       for(const file of selected){
        const sample=await fetchOfficial(file.url,{prefix:true});attempt.sampleHTTP=sample.httpStatus;
        if(sample.status!=='available'){attempt.status=sample.status;attempt.message=sample.message;attempt.retryAfter=sample.retryAfter;break;}
        const preview={file,...csvPreview(sample.bytes)};attempt.samples.push(preview);attempt.sample??=preview;
       }
       if(attempt.status==='available'){attempt.status='sample_received';attempt.message=`За последние 12 месяцев найдены файлы сделок. Получено образцов: ${attempt.samples.length}. Это образцы опубликованных кварталов, а не полная выгрузка сделок за год; цены ещё не добавлены в расчёт.`;}
      }
     }
    }
   }else attempt.retryAfter=catalog.retryAfter;
  }catch(e){attempt={...attempt,checkedAt,catalogURL:CATALOG,status:e.name==='TimeoutError'?'timeout':'unavailable',message:e.name==='TimeoutError'?'Росреестр не ответил вовремя. Получение сделок пока недоступно.':'Не удалось получить и распознать официальный файл: '+e.message,files:attempt?.files||[]};}
  finally{busy=false;}
  if(attempt.status==='limited'){const sec=Number(attempt.retryAfter),date=Date.parse(attempt.retryAfter||'');attempt.retryAt=Math.max(clock()+30000,sec>0?clock()+sec*1000:Number.isFinite(date)?date:clock()+60000);}
  const next={lastAttempt:attempt,lastSample:attempt.sample?{checkedAt,sample:attempt.sample,samples:attempt.samples}:previous?.lastSample||null,retryAt:attempt.retryAt||null};save(next);return status();
 }
 return {status,probe};
}
