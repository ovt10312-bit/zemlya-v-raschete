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
