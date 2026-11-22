import {deflateRawSync} from 'node:zlib';
import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createRosreestrSource,discoverDealFiles,csvPreview,inspectCatalogResponse,discoverQuarterFolders,transactionWindow} from '../server/rosreestr-source.mjs';
const csv='Кадастровый квартал;Площадь;Цена;Количество сделок\r\n40:04:010802;800;600000;1\r\n';
const html='<a href="/data-sets/dataset_СДЕЛКИ_r-r_01-92_y_2026_q_2.csv">Сделки 2026</a>';
function fixture(fetchImpl){const db=new DatabaseSync(':memory:');let time=Date.parse('2026-11-22T06:13:55.016Z');const args={db,fetchImpl,clock:()=>time};return {db,args,source:createRosreestrSource(args),tick(){time+=60001}};}

test('official catalog discovery accepts only fixed-host CSV deal files and picks latest known period',()=>{
 const files=discoverDealFiles(html+'<a href="https://other.example/deals.csv">Сделки</a><a href="http://rosreestr.gov.ru/deals.csv">Сделки</a><a href="/dataset_rent.csv">Аренда</a><a href="/dataset_deals_y_2026_q_3.csv">Сделки III</a>');assert.equal(files.length,2);assert.equal(files[0].period,'2026-Q3');assert.ok(files.every(f=>new URL(f.url).hostname==='rosreestr.gov.ru'));
});
test('CSV preview respects quoted separators and incomplete trailing records without importing prices',()=>{
 const p=csvPreview(new TextEncoder().encode('\uFEFFАдрес;Площадь;Цена\r\n"Кондрово; улица";800;600000\r\n"незавершённая'));assert.deepEqual(p.headers,['Адрес','Площадь','Цена']);assert.equal(p.rows.length,1);assert.equal(p.rows[0][0],'Кондрово; улица');assert.equal(p.calculationImport,false);assert.equal(p.schemaStatus,'unverified');assert.throws(()=>csvPreview(new TextEncoder().encode('<html>captcha</html>')),/HTML/);
});
test('source HTTP503 is persisted as failure, never an empty successful set of transactions',async()=>{
 const f=fixture(async()=>new Response('unavailable',{status:503}));try{const s=await f.source.probe();assert.equal(s.lastAttempt.status,'unavailable');assert.equal(s.lastAttempt.httpStatus,503);assert.equal(s.connected,false);assert.equal(s.lastSample,null);assert.match(s.lastAttempt.message,/не получены/);const restored=createRosreestrSource(f.args);assert.equal(restored.status().lastAttempt.httpStatus,503);}finally{f.db.close()}
});
test('catalog and bounded sample use official HTTPS, no credentials and no automatic price import',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push({url:String(url),options});return options.headers.range?new Response(csv,{headers:{'content-type':'text/csv'}}):new Response(html)});try{const r=await f.source.probe();assert.equal(calls.length,2);assert.equal(calls[1].options.headers.range,'bytes=0-65535');assert.ok(calls.every(c=>new URL(c.url).hostname==='rosreestr.gov.ru'&&c.options.credentials==='omit'&&c.options.redirect==='manual'));assert.equal(r.lastAttempt.status,'sample_received');assert.equal(r.lastAttempt.sample.rows.length,1);assert.equal(r.lastAttempt.sample.calculationImport,false);assert.equal(r.connected,false);await assert.rejects(f.source.probe(),/30 секунд/);}finally{f.db.close()}
});
test('foreign redirects stop before another host is fetched; prior sample survives later failure',async()=>{
 let fail=false;const calls=[];const f=fixture(async(url,options)=>{calls.push(String(url));return fail?new Response(null,{status:302,headers:{location:'https://outside.example/file.csv'}}):options.headers.range?new Response(csv):new Response(html)});try{await f.source.probe();f.tick();fail=true;const r=await f.source.probe();assert.equal(r.lastAttempt.status,'unavailable');assert.equal(r.lastSample.sample.rows.length,1);assert.ok(calls.every(c=>new URL(c).hostname==='rosreestr.gov.ru'));}finally{f.db.close()}
});
test('429 retry delay survives service recreation and HTML catalog without files stays unresolved',async()=>{
 const f=fixture(async()=>new Response('limit',{status:429,headers:{'retry-after':'60'}}));try{await f.source.probe();const next=createRosreestrSource(f.args);await assert.rejects(next.probe(),/подождать/);f.tick();const empty=createRosreestrSource({...f.args,fetchImpl:async()=>new Response('<html>Данные пока недоступны</html>')});const r=await empty.probe();assert.equal(r.lastAttempt.status,'schema_unknown');assert.equal(r.connected,false);}finally{f.db.close()}
});
test('a large CSV response is cancelled after the prefix instead of downloading the country file',async()=>{
 let cancel=false;const f=fixture(async(url,options)=>options.headers.range?new Response(new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode(csv.repeat(5000)))},cancel(){cancel=true}}),{headers:{'content-type':'text/csv','content-length':'900000000'}}):new Response(html));try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'sample_received');assert.ok(r.lastAttempt.sample.rows.length<=8);assert.equal(cancel,true);}finally{f.db.close()}
});


test('catalog discovery reads static attributes and declarative escaped JSON without executing scripts',()=>{
 const value='/data-sets/dataset_sdelki_y_2026_q_3.csv';
 const page='<a href=/data-sets/dataset_&#1057;ДЕЛКИ_y_2026_q_1.csv>CSV</a><button data-url="'+value+'">Файл</button><script type="application/json">'+JSON.stringify({files:[value,'https://outside.example/deals.csv']}).replaceAll('/','\\/')+'</script><script>fetch("/hidden_deals_y_2026_q_4.csv")</script><!-- <a href="/fake_deals.csv">Сделки</a> -->';
 const files=discoverDealFiles(page);assert.equal(files.length,2);assert.equal(files[0].period,'2026-Q3');assert.equal(files[1].period,'2026-Q1');assert.ok(files.every(f=>!f.name.includes('hidden')&&!f.name.includes('fake')));
});
test('diagnostics describe page structure without exporting raw scripts, cookies or body text',()=>{
 const page=inspectCatalogResponse('<title>Проверка доступа</title><script>const token="SECRET"</script><p>Подтвердите, что вы человек</p><a href="/readme.pdf?token=SECRET">Описание</a>','text/html',200);
 assert.equal(page.accessCheck,true);assert.equal(page.scriptCount,1);assert.deepEqual(page.fileNames,['readme.pdf']);assert.ok(!JSON.stringify(page).includes('SECRET'));assert.equal(inspectCatalogResponse('<noscript>Enable JavaScript</noscript>').javascriptRequired,true);
});
test('HTTP200 access challenge is not treated as catalog even if it includes a CSV link',async()=>{
 const f=fixture(async()=>new Response('<title>Access denied</title>'+html,{headers:{'content-type':'text/html'}}));try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'access_check');assert.equal(r.lastAttempt.httpStatus,200);assert.equal(r.lastAttempt.page.accessCheck,true);assert.deepEqual(r.lastAttempt.files,[]);assert.equal(r.lastSample,null);}finally{f.db.close()}
});
test('an unresolved HTTP200 report includes bounded page diagnostics and never claims catalog opened',async()=>{
 const f=fixture(async()=>new Response('<title>Данные</title><script src="/catalog.js"></script><div id="root"></div>',{headers:{'content-type':'text/html'}}));try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'schema_unknown');assert.equal(r.lastAttempt.page.title,'Данные');assert.equal(r.lastAttempt.page.scriptCount,1);assert.doesNotMatch(r.lastAttempt.message,/Каталог открылся/);assert.match(r.lastAttempt.message,/не означает отсутствие/);}finally{f.db.close()}
});


const quarterLink=(q,y,version='')=>{const name=`${q} квартал ${y}г.${version?', версия '+version:''}`;return '<a href="'+encodeURIComponent(name)+'/">'+name+'/</a>'};
test('rolling year follows all overlapping quarter folders, latest version per quarter, excluding archives and future periods',()=>{
 const window=transactionWindow(Date.parse('2026-11-22T06:13:55.016Z'));
 const page='<a href="../">../</a>'+quarterLink(1,2024)+quarterLink(3,2025)+quarterLink(4,2025)+quarterLink(1,2026)+quarterLink(2,2026)+quarterLink(3,2026)+quarterLink(3,2026,'2')+quarterLink(1,2027)+'<a href="https://outside.example/3 квартал 2026г./">3 квартал 2026г.</a><a href="/other/3 квартал 2026г./">3 квартал 2026г.</a>';
 const folders=discoverQuarterFolders(page,undefined,window);assert.equal(window.from,'2025-11-22T06:13:55.016Z');assert.deepEqual(folders.map(f=>f.period),['2026-Q3','2026-Q2','2026-Q1','2025-Q4']);assert.equal(folders[0].version,2);assert.equal(folders[3].partialPeriod,true);assert.equal(folders[0].partialPeriod,false);
});
test('quarterly index is traversed and relative CSV paths stay in their actual directory across four periods',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{
  calls.push(String(url));if(options.headers.range)return new Response(csv);
  if(new URL(url).pathname==='/data-sets/')return new Response(quarterLink(1,2024)+quarterLink(4,2025)+quarterLink(1,2026)+quarterLink(2,2026)+quarterLink(3,2026,'2'));
  return new Response('<a href="dataset_СДЕЛКИ.csv">Сделки</a><a href="../">../</a>');
 });try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'sample_received');assert.equal(r.lastAttempt.folders.length,4);assert.equal(r.lastAttempt.samples.length,4);assert.equal(calls.length,9);assert.equal(r.lastAttempt.samples[0].file.catalogPeriod,'2026-Q3');assert.ok(decodeURIComponent(r.lastAttempt.samples[0].file.url).includes('3 квартал 2026г., версия 2/dataset_СДЕЛКИ.csv'));assert.ok(!calls.some(c=>decodeURIComponent(c).includes('2024')));assert.equal(r.lastAttempt.samples.at(-1).file.partialPeriod,true);assert.equal(r.connected,false);assert.equal(r.lastSample.samples.length,4);}finally{f.db.close()}
});
test('quarter folder rate limit stops traversal immediately and persists retry without sampling or requesting older quarters',async()=>{
 let calls=0;const f=fixture(async()=>++calls===1?new Response(quarterLink(1,2026)+quarterLink(2,2026)):new Response('wait',{status:429,headers:{'retry-after':'60'}}));try{const r=await f.source.probe();assert.equal(calls,2);assert.equal(r.lastAttempt.status,'limited');assert.equal(r.lastAttempt.httpStatus,200);assert.equal(r.lastAttempt.folders[0].httpStatus,429);assert.equal(r.lastSample,null);assert.ok(r.retryAt);await assert.rejects(createRosreestrSource(f.args).probe(),/подождать/);}finally{f.db.close()}
});
test('quarterly preview failure retains earlier period samples without reporting the whole year complete',async()=>{
 let prefixes=0;const f=fixture(async(url,options)=>options.headers.range?(++prefixes===1?new Response(csv):new Response('denied',{status:403})):new URL(url).pathname==='/data-sets/'?new Response(quarterLink(1,2026)+quarterLink(2,2026)):new Response('<a href="dataset_СДЕЛКИ.csv">Сделки</a>'));try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'denied');assert.equal(r.lastAttempt.samples.length,1);assert.equal(r.lastSample.samples.length,1);assert.equal(r.connected,false);}finally{f.db.close()}
});
test('direct root files outside the requested year are excluded; unknown file dates remain explicitly unknown',async()=>{
 const requested=[];const f=fixture(async(url,options)=>{requested.push(String(url));return options.headers.range?new Response(csv):new Response('<a href="old_deals_y_2024_q_4.csv">Сделки</a><a href="deals.csv">Сделки</a>')});try{const r=await f.source.probe();assert.equal(r.lastAttempt.samples.length,1);assert.equal(r.lastAttempt.sample.file.period,null);assert.equal(r.lastAttempt.sample.file.partialPeriod,null);assert.ok(!requested.some(x=>x.includes('2024')));}finally{f.db.close()}
});

// Exact published folder copied by the user from the Rosreestr directory.
const legacyFolder='3%20%EA%E2%E0%F0%F2%E0%EB%202026%E3%2C%20%E2%E5%F0%F1%E8%FF%202/';
const legacyFile='dataset_%D1%C4%C5%CB%CA%C8_y_2026_q_3.csv';
test('legacy Cyrillic percent encoding is recognized while retaining the exact published folder and CSV bytes',()=>{
 const base='https://rosreestr.gov.ru/data-sets/',window=transactionWindow(Date.parse('2026-11-22'));
 const folders=discoverQuarterFolders(`<a href="${legacyFolder}">3 квартал 2026г., версия 2/</a>`,base,window);
 assert.equal(folders.length,1);assert.equal(folders[0].name,'3 квартал 2026г, версия 2');assert.equal(folders[0].version,2);assert.equal(folders[0].url,base+legacyFolder);
 const files=discoverDealFiles(`<a href="${legacyFile}">Сделки</a>`,folders[0].url);assert.equal(files[0].name,'dataset_СДЕЛКИ_y_2026_q_3.csv');assert.equal(files[0].url,base+legacyFolder+legacyFile);
 const page=inspectCatalogResponse(`<a href="${legacyFolder}?token=SECRET">Квартал</a><a href="%CE%EF%E8%F1%E0%ED%E8%E5.pdf">Описание</a>`);assert.deepEqual(page.fileNames,['Описание.pdf']);assert.equal(page.publishedLinks[0].href,base+legacyFolder);assert.ok(!JSON.stringify(page).includes('SECRET'));
});
test('legacy quarterly catalog reaches sample using original byte-encoded URLs, with no Unicode URL reconstruction',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push(String(url));return options.headers.range?new Response(csv):calls.length===1?new Response(`<title>Index of /data-sets/</title><a href="${legacyFolder}">Квартал</a>`):new Response(`<a href="${legacyFile}">Сделки</a>`)});
 try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'sample_received');assert.deepEqual(calls,['https://rosreestr.gov.ru/data-sets/','https://rosreestr.gov.ru/data-sets/'+legacyFolder,'https://rosreestr.gov.ru/data-sets/'+legacyFolder+legacyFile]);assert.equal(r.lastAttempt.sample.rows.length,1);}finally{f.db.close()}
});
test('legacy HTML bodies are decoded from declared charset or invalid UTF8, leaving UTF8 unaffected',async()=>{
 const alphabet=new TextDecoder('windows-1251').decode(Uint8Array.from({length:256},(_,i)=>i));
 const content=`<title>Каталог Росреестра</title><a href="${legacyFolder}">Квартал</a>`;
 const bytes=Uint8Array.from(content,c=>{const i=alphabet.indexOf(c);assert.ok(i>=0);return i});
 for(const type of ['text/html; charset=windows-1251','text/html']){const f=fixture(async(url,options)=>options.headers.range?new Response(csv):new URL(url).pathname==='/data-sets/'?new Response(bytes,{headers:{'content-type':type}}):new Response(`<a href="${legacyFile}">Сделки</a>`));try{const r=await f.source.probe();assert.equal(r.lastAttempt.page.title,'Каталог Росреестра');assert.equal(r.lastAttempt.status,'sample_received');}finally{f.db.close()}}
});


test('published CSV.zip deal links are discovered with the updated schema version, excluding rent and cadastral cost archives',()=>{
 const base='https://rosreestr.gov.ru/data-sets/'+legacyFolder;
 const page='<a href="dataset_%D1%C4%C5%CB%CA%C8_r-r_01-92_y_2026_q_3_v2.csv.zip">Сделки</a><a href="dataset_%C0%D0%C5%CD%C4%C0_r-r_01-92_y_2026_q_3_v2.csv.zip">Аренда</a><a href="dataset_%CA%C0%C4%C0%D1%D2%D0%D1%D2%CE%C8%CC%CE%D1%D2%DC_r-r_40-59_y_2026_q_3.csv.zip">Кадастровая стоимость</a>';
 const files=discoverDealFiles(page,base);assert.equal(files.length,1);assert.equal(files[0].format,'zip');assert.equal(files[0].version,2);assert.equal(files[0].period,'2026-Q3');assert.equal(files[0].url,base+'dataset_%D1%C4%C5%CB%CA%C8_r-r_01-92_y_2026_q_3_v2.csv.zip');
});
test('official zip prefix is bounded, decompressed for schema preview and kept outside calculator imports',async()=>{
 const name=Buffer.from('dataset_СДЕЛКИ.csv'),compressed=deflateRawSync(Buffer.from(csv)),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(0x808,6);header.writeUInt16LE(8,8);header.writeUInt16LE(name.length,26);const zip=Buffer.concat([header,name,compressed]);
 const calls=[];const f=fixture(async(url,options)=>{calls.push({url:String(url),options});return options.headers.range?new Response(zip,{status:206,headers:{'content-type':'application/zip'}}):new Response('<a href="dataset_СДЕЛКИ_y_2026_q_3_v2.csv.zip">Сделки</a>')});try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'sample_received');assert.equal(r.lastAttempt.sample.archive.prefixOnly,true);assert.equal(r.lastAttempt.sample.archive.integrity,'not_verified_full_archive');assert.deepEqual(r.lastAttempt.sample.rows[0],['40:04:010802','800','600000','1']);assert.equal(r.lastAttempt.sample.calculationImport,false);assert.equal(r.connected,false);assert.equal(calls[1].options.headers.range,'bytes=0-65535');}finally{f.db.close()}
});

test('CSV preview supports pipe delimiters, Excel delimiter declarations and UTF16 without BOM',()=>{
 const a=csvPreview(new TextEncoder().encode('Квартал|Площадь|Цена\r\n40:04:010802|800|600000\r\n'));assert.equal(a.delimiter,'|');assert.equal(a.rows.length,1);
 const b=csvPreview(new TextEncoder().encode('sep=;\r\nКвартал;Площадь;Цена\r\n40:04:010802;800;600000\r\n'));assert.deepEqual(b.headers,['Квартал','Площадь','Цена']);
 const c=csvPreview(Buffer.from('quarter;area;price\r\n40:04:010802;800;600000\r\n','utf16le'));assert.equal(c.encoding,'utf-16le');assert.equal(c.rows.length,1);
});
test('unknown CSV does not stop other quarters and original bytes survive a restart for offline reparse',async()=>{
 let calls=0;const unknown=Buffer.from('Quarter^Area^Price\r\n40:04:010802^800^600000\r\n');
 const f=fixture(async(url,options)=>{calls++;if(options.headers.range)return new Response(String(url).includes('q_3')?unknown:csv,{status:206});return new Response('<a href="deals_y_2026_q_3.csv">Сделки</a><a href="deals_y_2026_q_2.csv">Сделки</a>')});
 try{const result=await f.source.probe();assert.equal(result.lastAttempt.status,'schema_unknown');assert.equal(result.lastAttempt.fileReads.length,2);assert.equal(result.lastAttempt.samples.length,1);assert.equal(result.cacheCount,2);const saved=result.prefixCache.find(c=>c.file.period==='2026-Q3');assert.deepEqual(Buffer.from(saved.prefixBase64,'base64'),unknown);assert.deepEqual(Buffer.from(saved.csvPrefixBase64,'base64'),unknown);assert.equal(result.lastAttempt.fileReads[0].stage,'csv');assert.equal(result.lastAttempt.fileReads[0].formatProbe.lines[0],'Quarter^Area^Price');
  const before=calls;const restored=createRosreestrSource({...f.args,fetchImpl:()=>{throw Error('Offline reparse must never fetch')}});const replay=await restored.reparse();assert.equal(calls,before);assert.equal(replay.lastAttempt.fromCache,true);assert.equal(replay.lastAttempt.networkRequests,0);assert.equal(replay.busy,false);assert.equal(replay.lastAttempt.samples.length,1);assert.equal(replay.cacheCount,2);assert.equal(replay.connected,false);
 }finally{f.db.close()}
});
test('an updated parser can replay previously unresolved stored input with zero external requests',async()=>{
 const f=fixture(()=>{throw Error('No network')});const text='Quarter|Area|Price\r\n40:04:010802|800|600000\r\n';
 try{f.db.prepare('INSERT INTO rosreestr_source_state VALUES(1,?)').run(JSON.stringify({lastAttempt:{status:'schema_unknown'},prefixCache:[{file:{url:'https://rosreestr.gov.ru/data-sets/deals_y_2026_q_3.csv',format:'csv',period:'2026-Q3',version:1},downloadedAt:'2026-11-22T06:00:00Z',httpStatus:206,prefixBase64:Buffer.from(text).toString('base64')}]}));const r=await f.source.reparse();assert.equal(r.lastAttempt.status,'sample_received');assert.equal(r.lastAttempt.networkRequests,0);assert.equal(r.lastAttempt.sample.delimiter,'|');assert.equal(r.lastAttempt.sample.calculationImport,false);}finally{f.db.close()}
});
test('downloaded prefix is committed before requesting the next quarter and survives later source failure',async()=>{
 let count=0;const f=fixture(async(url,options)=>{if(!options.headers.range)return new Response('<a href="deals_y_2026_q_3.csv">Сделки</a><a href="deals_y_2026_q_2.csv">Сделки</a>');if(++count===1)return new Response(csv);const persisted=JSON.parse(f.db.prepare('SELECT payload FROM rosreestr_source_state WHERE id=1').get().payload);assert.equal(persisted.prefixCache.length,1);return new Response('wait',{status:429,headers:{'retry-after':'60'}})});
 try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'limited');assert.equal(r.cacheCount,1);const retry=r.retryAt;const next=await f.source.reparse();assert.equal(next.lastAttempt.networkRequests,0);assert.equal(next.retryAt,retry);await assert.rejects(f.source.probe(),/30 секунд|подождать/);}finally{f.db.close()}
});
test('a later network failure never erases cached originals or prevents offline reparse',async()=>{
 let fail=false;const f=fixture(async(url,options)=>fail?new Response('error',{status:503}):options.headers.range?new Response(csv):new Response(html));try{await f.source.probe();f.tick();fail=true;const failure=await f.source.probe();assert.equal(failure.cacheCount,1);const restored=createRosreestrSource({...f.args,fetchImpl:()=>{throw Error('No network')}});const replay=await restored.reparse();assert.equal(replay.lastAttempt.status,'sample_received');assert.equal(replay.lastAttempt.fromCache,true);}finally{f.db.close()}
});
test('HTML returned instead of ZIP is not cached as raw script content',async()=>{
 const f=fixture(async(url,options)=>options.headers.range?new Response('<html><script>const secret="PRIVATE_TOKEN";</script>Access check</html>'):new Response('<a href="deals_y_2026_q_3.csv.zip">Сделки</a>'));try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'schema_unknown');assert.equal(r.cacheCount,0);assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'));}finally{f.db.close()}
});
test('official schema PDFs are captured with the same report even when CSV parsing fails',async()=>{
 const calls=[];const names=['Описание дата-сета Сделки.pdf','Описание датасетов версии 2.pdf','Справочники.pdf'];
 const f=fixture(async(url,options)=>{calls.push(String(url));if(options.headers.accept==='application/pdf')return new Response('%PDF-1.7\nfixture only',{headers:{'content-type':'application/pdf'}});if(options.headers.range)return new Response('unrecognized source format\n');return new Response('<a href="deals_y_2026_q_3.csv">Сделки</a>'+names.map(name=>'<a href="'+encodeURIComponent(name)+'">'+name+'</a>').join('')+'<a href="https://outside.example/Описание.pdf">Описание</a>')});
 try{const r=await f.source.probe();assert.equal(r.lastAttempt.status,'schema_unknown');assert.equal(r.documentationCache.length,3);assert.equal(r.lastAttempt.documentation.length,3);assert.ok(r.documentationCache.every(d=>Buffer.from(d.pdfBase64,'base64').subarray(0,5).toString()==='%PDF-'));assert.ok(calls.every(url=>new URL(url).hostname==='rosreestr.gov.ru'));const n=calls.length;const replay=await f.source.reparse();assert.equal(calls.length,n);assert.equal(replay.documentationCache.length,3);}finally{f.db.close()}
});
test('oversized descriptions are cancelled and reported without deleting saved CSV fragments',async()=>{
 let cancelled=false;const f=fixture(async(url,options)=>options.headers.accept==='application/pdf'?new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(600000))},cancel(){cancelled=true}})):options.headers.range?new Response(csv):new Response(html+'<a href="Описание.pdf">Описание</a>'));try{const r=await f.source.probe();assert.equal(cancelled,true);assert.equal(r.cacheCount,1);assert.equal(r.documentationCache.length,0);assert.match(r.lastAttempt.documentation[0].message,/512/);}finally{f.db.close()}
});


test('all four unknown quarterly ZIPs retain both compressed and CSV bytes for a single complete report',async()=>{
 const unknown=Buffer.from('Unsupported^source^layout\r\n40:04:010802^800^600000\r\n');const name=Buffer.from('deals.csv'),compressed=deflateRawSync(unknown),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(0x808,6);header.writeUInt16LE(8,8);header.writeUInt16LE(name.length,26);const zip=Buffer.concat([header,name,compressed]);
 const f=fixture(async(url,options)=>options.headers.range?new Response(zip,{status:206}):new URL(url).pathname==='/data-sets/'?new Response(quarterLink(3,2026,'2')+quarterLink(2,2026)+quarterLink(1,2026)+quarterLink(4,2025)):new Response('<a href="deals.csv.zip">Сделки</a>'));
 try{const result=await f.source.probe();assert.equal(result.lastAttempt.status,'schema_unknown');assert.equal(result.cacheCount,4);assert.equal(result.lastAttempt.fileReads.length,4);assert.ok(result.lastAttempt.fileReads.every(r=>r.stage==='csv'&&r.prefixRetained));for(const c of result.prefixCache){assert.deepEqual(Buffer.from(c.prefixBase64,'base64'),zip);assert.deepEqual(Buffer.from(c.csvPrefixBase64,'base64'),unknown)}const replay=await createRosreestrSource({...f.args,fetchImpl:()=>{throw Error('No network')}}).reparse();assert.equal(replay.lastAttempt.fileReads.length,4);assert.equal(replay.lastAttempt.networkRequests,0);assert.equal(replay.busy,false);assert.equal(replay.cacheCount,4);}finally{f.db.close()}
});

test('documented Rosreestr tilde format recognizes both header versions while retaining aggregation and date semantics',()=>{
 const tail='okato~region_code~district~city~quarter_cad_number~street~realestate_type_code~wall_material_code~year_build~floor~purpose_code~area~period_start_date~deal_price~currency~doc_type';
 for(const first of ['number','deals_number']){const text=first+'~'+tail+'\n2~-~40~Дзержинский~Кондрово~40:04:010802~~002001001000~""~~~142001010000~1400~2026-07-01~900000~руб~ДКП\n';const p=csvPreview(Buffer.from(text));assert.equal(p.delimiter,'~');assert.equal(p.headers.length,17);assert.equal(p.rows[0].length,17);assert.equal(p.schemaStatus,'official_columns_recognized');assert.equal(p.dataset.rowKind,'quarterly_group');assert.equal(p.dataset.dateKind,'quarter_start');assert.equal(p.dataset.hasParcelCadastre,false);assert.equal(p.dataset.version,first==='number'?1:2);assert.equal(p.calculationImport,false);assert.equal(p.rows[0][0],'2');}
});
