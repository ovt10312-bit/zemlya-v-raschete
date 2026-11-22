import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createRosreestrSource,discoverDealFiles,csvPreview} from '../server/rosreestr-source.mjs';
const csv='Кадастровый квартал;Площадь;Цена;Количество сделок\r\n40:04:010802;800;600000;1\r\n';
const html='<a href="/data-sets/dataset_СДЕЛКИ_r-r_01-92_y_2026_q_2.csv">Сделки 2026</a>';
function fixture(fetchImpl){const db=new DatabaseSync(':memory:');let time=200000;const args={db,fetchImpl,clock:()=>time};return {db,args,source:createRosreestrSource(args),tick(){time+=60001}};}

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
