import {zipCSVPrefix} from './rosreestr-zip.mjs';
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
  try{let visited=0;function visit(v,depth=0){if(++visited>30000||depth>20)return;if(typeof v==='string'){if(/\.csv(?:\.zip)?(?:[?#]|$)/i.test(v))links.push({value:v,title:''})}else if(v&&typeof v==='object')for(const x of Object.values(v))visit(x,depth+1)}visit(JSON.parse(m[1]));}catch{/* Unknown JSON is not interpreted as code. */}
 }
 return links;
}
export function discoverDealFiles(html,base=CATALOG){
 const files=[],seen=new Set();
 for(const link of catalogLinks(html)){
  try{const url=officialURL(link.value,base);const decoded=decodePathName(url.pathname);const title=link.title,name=decoded.split('/').at(-1);
   if(!/\.csv(?:\.zip)?$/i.test(name)||!/(сделк|sdelk|deal)/i.test(name+' '+title)||seen.has(url.href))continue;
   seen.add(url.href);const period=name.match(/(?:^|_)y_(20\d{2})_q_([1-4])(?:\D|$)/i);files.push({id:url.href,url:url.href,name,title,format:/\.zip$/i.test(name)?'zip':'csv',version:Number(name.match(/_v(\d+)\.csv/i)?.[1]||1),period:period?`${period[1]}-Q${period[2]}`:null});
  }catch{/* External links, scripts and unrelated datasets are never fetched. */}
 }
 return files.sort((a,b)=>(b.period||'').localeCompare(a.period||'')||b.version-a.version||a.name.localeCompare(b.name)).slice(0,40);
}
function discoverDocumentation(html,base){
 const result=[],seen=new Set();for(const link of catalogLinks(html)){try{const url=officialURL(link.value,base),name=decodePathName(url.pathname).split('/').at(-1);if(!url.pathname.startsWith('/data-sets/')||!/\.pdf$/i.test(name)||!/(описан|справочник)/i.test(name)||seen.has(url.href))continue;seen.add(url.href);result.push({url:url.href,name});}catch{}}
 return result.slice(0,3);
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
function decodeCSV(bytes){
 let encoding='utf-8';
 if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
 else {const n=Math.min(bytes.length,400);let even=0,odd=0;for(let i=0;i<n;i++)if(bytes[i]===0){if(i%2)odd++;else even++}if(odd>n/5&&even<n/20)encoding='utf-16le';else if(even>n/5&&odd<n/20)encoding='utf-16be';}
 let text;try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes,{stream:true})}catch{encoding='windows-1251';text=new TextDecoder(encoding).decode(bytes)}
 return {encoding,text:text.replace(/^\uFEFF/,'')};
}
function formatProbe(bytes){const {encoding,text}=decodeCSV(bytes);return {encoding,byteLength:bytes.length,firstBytesHex:Buffer.from(bytes.subarray(0,32)).toString('hex'),...( /^\s*</.test(text)?{html:true}:{lines:text.split(/\r\n|\n|\r/).slice(0,5).map(line=>line.slice(0,1000))})};}
export function csvPreview(bytes){
 let {encoding,text}=decodeCSV(bytes);if(/^\s*</.test(text))throw Error('Вместо CSV получена HTML-страница. Цены не загружены.');
 const hint=text.match(/^sep=([;,\t|])\r?\n/i);if(hint)text=text.slice(hint[0].length);
 function parse(delimiter){const records=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length&&records.length<9;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
   else if(!quoted&&c===delimiter){row.push(field);field='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))records.push(row);row=[];field='';}
   else field+=c;
  }
  return records;
 }
 const delimiters=hint?[hint[1]]:[';',',','\t','|'];
 const candidates=delimiters.map(delimiter=>{const records=parse(delimiter),width=records[0]?.length||0;return {delimiter,records,width,consistent:width>=3?records.slice(1).filter(row=>row.length===width).length:-1}}).sort((a,b)=>b.consistent-a.consistent||b.width-a.width),best=candidates[0];
 if(best.width<3)throw Error('Структура CSV не распознана. Цены не загружены.');
 const headers=best.records[0].map(s=>s.trim().slice(0,300));if(headers.length>80)throw Error('Неожиданно много полей в выгрузке.');
 const rows=best.records.slice(1).filter(row=>row.length===headers.length).map(row=>row.map(v=>v.slice(0,1000)));
 return {encoding,delimiter:best.delimiter,headers,rows,schemaStatus:'unverified',calculationImport:false};
}
export function createRosreestrSource({db,fetchImpl=globalThis.fetch,clock=()=>Date.now(),timeout=12000}){
 db.exec('CREATE TABLE IF NOT EXISTS rosreestr_source_state(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);');let busy=false,lastCall=null;
 const read=()=>{const r=db.prepare('SELECT payload FROM rosreestr_source_state WHERE id=1').get();return r?JSON.parse(r.payload):null};
 const save=d=>db.prepare('INSERT INTO rosreestr_source_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(d));
 function status(){const saved=read();return {...saved,cacheCount:saved?.prefixCache?.length||0,busy,catalogURL:CATALOG,connected:false,notice:'Образец официальной выгрузки ещё не является подключёнными сделками для расчёта. Личные сведения и Telegram не запрашиваются.'};}
 async function fetchOfficial(url,{prefix=false,document=false}={}){
  let target=officialURL(url);const signal=AbortSignal.timeout(timeout);
  for(let hop=0;hop<4;hop++){
   const response=await fetchImpl(target,{headers:{accept:prefix?'application/zip,text/csv,application/octet-stream;q=0.8':document?'application/pdf':'text/html',...(prefix?{range:'bytes=0-65535'}:{})},credentials:'omit',redirect:'manual',signal});
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Источник перенаправил запрос без адреса.');target=officialURL(location,target);continue;}
   const base={url:target.href,httpStatus:response.status};
   if(!response.ok){await response.body?.cancel();return {...base,status:response.status===403?'denied':response.status===429?'limited':'unavailable',retryAfter:response.headers.get('retry-after'),message:`Росреестр вернул HTTP ${response.status}. Данные о сделках не получены.`};}
   const limit=prefix?65536:document?524288:3000000,reader=response.body?.getReader();if(!reader)throw Error('Источник вернул пустой ответ.');const chunks=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;const take=prefix?value.subarray(0,Math.max(0,limit-size)):value;size+=take.length;if(size>limit){await reader.cancel();throw Error(document?'Описание формата превышает лимит 512 КиБ.':'Страница каталога слишком велика.');}chunks.push(take);if(prefix&&size>=limit){await reader.cancel();break;}}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return {...base,status:'available',bytes,contentType:response.headers.get('content-type')||'',contentRange:response.headers.get('content-range')||null};
  }
  throw Error('Слишком много перенаправлений официального источника.');
 }
 async function probe(){
  if(busy)throw Error('Проверка источника уже идёт.');if(lastCall!==null&&clock()-lastCall<30000)throw Error('Повторить проверку можно через 30 секунд.');const previous=read();if(previous?.retryAt&&clock()<previous.retryAt)throw Error('Источник попросил подождать до '+new Date(previous.retryAt).toLocaleString('ru-RU'));
  busy=true;lastCall=clock();const checkedAt=new Date(clock()).toISOString();let attempt;const captured=[],documents=[];
  try{const catalog=await fetchOfficial(CATALOG);const window=transactionWindow(clock());attempt={checkedAt,status:catalog.status,httpStatus:catalog.httpStatus,catalogURL:CATALOG,window,folders:[],files:[],samples:[],fileReads:[],message:catalog.message};
   if(catalog.status==='available'){
    const html=decodeCatalog(catalog.bytes,catalog.contentType),documentation=discoverDocumentation(html,catalog.url),page=inspectCatalogResponse(html,catalog.contentType,catalog.bytes.length,catalog.url);attempt.page=page;
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
      attempt.files.sort((a,b)=>(b.period||b.catalogPeriod||'').localeCompare(a.period||a.catalogPeriod||'')||b.version-a.version||a.name.localeCompare(b.name));
      if(!attempt.files.length){attempt.status='schema_unknown';attempt.message=page.javascriptRequired?'Для страницы требуется JavaScript. Ссылки на файлы в полученном ответе отсутствуют; сделки не загружены.':folders.length?'Папки за последние 12 месяцев открыты, но файлы CSV/ZIP сделок внутри не распознаны. Это не означает отсутствие сделок.':'Сервер ответил, но ссылки на CSV сделок за последние 12 месяцев не найдены. Доступ к каталогу и формат ответа пока не подтверждены; это не означает отсутствие сделок.';}
      else {
       // At most one bounded preview per published quarter; no full-country download.
       const seen=new Set(),selected=attempt.files.filter(f=>{const key=f.period||f.catalogPeriod||'unknown';if(seen.has(key))return false;seen.add(key);return true}).slice(0,5);
       for(const file of selected){
        const sample=await fetchOfficial(file.url,{prefix:true});attempt.sampleHTTP=sample.httpStatus;
        if(sample.status!=='available'){attempt.status=sample.status;attempt.message=sample.message;attempt.retryAfter=sample.retryAfter;break;}
        const entry={file,downloadedAt:checkedAt,httpStatus:sample.httpStatus,contentType:sample.contentType,contentRange:sample.contentRange,prefixBase64:Buffer.from(sample.bytes).toString('base64'),prefixByteLength:sample.bytes.length,window};
        // Public file data only: do not export an HTML challenge as raw page code.
        const isZIP=sample.bytes[0]===0x50&&sample.bytes[1]===0x4b;
        if(file.format==='zip'&&!isZIP||file.format!=='zip'&&formatProbe(sample.bytes).html){attempt.fileReads.push({file,httpStatus:sample.httpStatus,status:'schema_unknown',message:'Вместо таблицы или ZIP получен другой ответ.',page:inspectCatalogResponse(decodeCatalog(sample.bytes,sample.contentType),sample.contentType,sample.bytes.length,sample.url)});continue;}
        captured.push(entry);persist({...attempt,status:'collecting',message:`Сохранено фрагментов: ${captured.length}. Читаем опубликованные периоды за последние 12 месяцев.`},previous,captured);await parseCapture(entry,attempt);
       }
       if(attempt.status==='available')summarize(attempt);
       if(captured.length&&!['denied','limited','unavailable','access_check'].includes(attempt.status)){
        attempt.documentation=[];
        for(const item of documentation){
         try{const result=await fetchOfficial(item.url,{document:true}),record={...item,httpStatus:result.httpStatus,status:result.status};attempt.documentation.push(record);
          if(result.status!=='available'){if(result.status==='limited'){attempt.status='limited';attempt.retryAfter=result.retryAfter;attempt.message=result.message;}break;}
          if(!Buffer.from(result.bytes.subarray(0,5)).equals(Buffer.from('%PDF-'))){record.status='schema_unknown';record.message='Вместо PDF получен другой ответ.';continue;}
          record.status='pdf_received';record.byteLength=result.bytes.length;documents.push({...record,downloadedAt:checkedAt,pdfBase64:Buffer.from(result.bytes).toString('base64')});
          persist({...attempt,status:'collecting',message:`Сохранено фрагментов: ${captured.length}, описаний формата: ${documents.length}.`},previous,captured,documents);
         }catch(e){attempt.documentation.push({...item,status:'unavailable',message:e.message});break;}
        }
       }
      }
     }
    }
   }else attempt.retryAfter=catalog.retryAfter;
  }catch(e){attempt={...attempt,checkedAt,catalogURL:CATALOG,status:e.name==='TimeoutError'?'timeout':'unavailable',message:e.name==='TimeoutError'?'Росреестр не ответил вовремя. Получение сделок пока недоступно.':'Не удалось получить и распознать официальный файл: '+e.message,files:attempt?.files||[]};}
  finally{busy=false;}
  if(attempt.status==='limited'){const sec=Number(attempt.retryAfter),date=Date.parse(attempt.retryAfter||'');attempt.retryAt=Math.max(clock()+30000,sec>0?clock()+sec*1000:Number.isFinite(date)?date:clock()+60000);}
  return persist(attempt,previous,captured,documents);
 }
 async function parseCapture(entry,attempt){
  const record={file:entry.file,httpStatus:entry.httpStatus,downloadedAt:entry.downloadedAt,prefixRetained:true,stage:'archive'};attempt.fileReads.push(record);
  try{
   const downloaded=Buffer.from(entry.prefixBase64,'base64');if(downloaded.length>65536)throw Error('Превышен лимит сохранённого фрагмента.');
   const unpacked=entry.file.format==='zip'?await zipCSVPrefix(downloaded):{bytes:downloaded};record.stage='csv';
   const probe=formatProbe(unpacked.bytes);entry.archive=unpacked.archive||null;record.archive=entry.archive;record.formatProbe=probe;
   if(!probe.html)entry.csvPrefixBase64=Buffer.from(unpacked.bytes).toString('base64');
   const preview={file:entry.file,...csvPreview(unpacked.bytes),...(unpacked.archive?{archive:unpacked.archive}:{})};attempt.samples.push(preview);attempt.sample??=preview;record.status='parsed';
  }catch(e){record.status='schema_unknown';record.message=e.message;}
 }
 function summarize(attempt){const errors=attempt.fileReads.filter(r=>r.status!=='parsed').length;
  attempt.status=errors?'schema_unknown':'sample_received';attempt.message=errors?`Фрагментов сохранено: ${attempt.fileReads.filter(r=>r.prefixRetained).length}; таблиц распознано: ${attempt.samples.length}; ошибок формата: ${errors}. Исходные фрагменты включены в отчёт и доступны для повторного разбора без скачивания. Цены не добавлены в расчёт.`:`За последние 12 месяцев получено образцов: ${attempt.samples.length}. ${attempt.fromCache?'Повторный разбор выполнен из сохранённых файлов, новых запросов к Росреестру нет.':'Исходные фрагменты сохранены для повторного разбора без скачивания.'} Это не полная выгрузка сделок за год; цены ещё не добавлены в расчёт.`;
 }
 function persist(attempt,previous,captured,documents=[]){
  const merged=new Map((previous?.prefixCache||[]).map(c=>[c.file.url,c]));for(const c of captured)merged.set(c.file.url,c);
  const seenPeriods=new Set(),prefixCache=[...merged.values()].sort((a,b)=>(b.file.period||b.file.catalogPeriod||'').localeCompare(a.file.period||a.file.catalogPeriod||'')||(b.file.version||1)-(a.file.version||1)||b.downloadedAt.localeCompare(a.downloadedAt)).filter(c=>{const key=c.file.period||c.file.catalogPeriod||c.file.url;if(seenPeriods.has(key))return false;seenPeriods.add(key);return true}).slice(0,5);
  const docs=new Map((previous?.documentationCache||[]).map(d=>[d.url,d]));for(const d of documents)docs.set(d.url,d);
  save({lastAttempt:attempt,lastSample:attempt.sample?{checkedAt:attempt.checkedAt,sample:attempt.sample,samples:attempt.samples}:previous?.lastSample||null,retryAt:attempt.retryAt||(attempt.fromCache?previous?.retryAt:null)||null,prefixCache,documentationCache:[...docs.values()].slice(0,3)});return status();
 }
 async function reparse(){
  if(busy)throw Error('Проверка источника уже идёт.');const previous=read(),window=transactionWindow(clock()),cached=(previous?.prefixCache||[]).filter(c=>{const period=c.file.period||c.file.catalogPeriod;return !period||overlapsWindow(period,window)}).map(c=>({...c,file:{...c.file,partialPeriod:partialPeriod(c.file.period||c.file.catalogPeriod,window)}}));if(!cached.length)throw Error('Сохранённых фрагментов за последние 12 месяцев нет. Сначала проверь источник.');
  busy=true;const checkedAt=new Date(clock()).toISOString(),attempt={checkedAt,status:'available',httpStatus:null,catalogURL:CATALOG,window,folders:[],files:cached.map(c=>c.file),samples:[],fileReads:[],fromCache:true,networkRequests:0};
  try{for(const entry of cached)await parseCapture(entry,attempt);summarize(attempt)}finally{busy=false}
  return persist(attempt,previous,cached);
 }
 return {status,probe,reparse};
}
