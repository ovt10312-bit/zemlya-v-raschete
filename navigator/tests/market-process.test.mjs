import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import http from 'node:http';
import {once} from 'node:events';
import {createMarketProcess} from '../server/market-process.mjs';
import {createMarketService} from '../server/market-service.mjs';
const workerURL=new URL('./fixtures/market-process-fixture.mjs',import.meta.url);
test('actual browser child exit is contained and a new process can serve the next search',async()=>{
 const market=createMarketProcess({root:'/tmp',workerURL,timeoutMs:3000});
 try{
  const result=await market.avito({settlement:'crash'});assert.equal(result.status,'automation_failed');assert.equal(result.stage,'browser_process');assert.match(result.message,/23/);
  const next=await market.cian({settlement:'normal'});assert.equal(next.status,'schema_unknown');assert.equal(next.source,'ЦИАН');
 }finally{market.close()}
});
test('an unresponsive child is stopped and concurrent pending sources receive explicit failure',async()=>{
 const market=createMarketProcess({root:'/tmp',workerURL,timeoutMs:300});
 try{const results=await Promise.all([market.avito({settlement:'hang'}),market.cian({settlement:'hang'})]);assert.ok(results.every(r=>r.status==='timeout'&&r.stage==='browser_timeout'&&!r.connected));}finally{market.close()}
});
test('HTTP start returns saved running state; child failure does not break the server or status endpoint',async()=>{
 const db=new DatabaseSync(':memory:');const process=createMarketProcess({root:'/tmp',workerURL,timeoutMs:3000});
 const market=createMarketService({db,...process});const parcel={id:'p',settlement:'crash',region:'Калужская область',usage:'ИЖС'};
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='POST'?market.start(parcel):req.url==='/health'?{ok:true}:market.status('p')))});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  const started=await(await fetch(base,{method:'POST'})).json();assert.equal(started.jobStatus,'running');
  assert.deepEqual(await(await fetch(base+'/health')).json(),{ok:true});
  const completed=await new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const poll=()=>{const s=market.status('p');if(s.jobStatus==='completed')resolve(s);else if(Date.now()>deadline)reject(Error('Job did not finish'));else setTimeout(poll,10)};poll()});
  assert.ok(completed.sources.every(s=>s.status==='automation_failed'));assert.equal((await fetch(base)).status,200);assert.deepEqual(await(await fetch(base+'/health')).json(),{ok:true});
 }finally{process.close();server.close();server.closeAllConnections();db.close()}
});
test('background start refuses duplicate searches and recovers persisted state after restart',async()=>{
 const db=new DatabaseSync(':memory:');let finish;const avito=()=>new Promise(resolve=>{finish=resolve});
 const market=createMarketService({db,avito,cian:async()=>({source:'ЦИАН',listings:[]})});
 try{
  const parcel={id:'p',settlement:'Кондрово'};assert.equal(market.start(parcel).jobStatus,'running');
  assert.throws(()=>market.start(parcel),/уже идёт/);await Promise.resolve();finish({source:'Авито',listings:[]});
  // Let the actual pending operation complete, then simulate a persisted job
  // interrupted by a previous server exit.
  await new Promise(resolve=>setImmediate(resolve));assert.equal(market.status('p').jobStatus,'completed');
  const old={...market.status('p'),jobStatus:'running'};db.prepare('UPDATE market_sources SET payload=? WHERE parcel_id=?').run(JSON.stringify(old),'p');
  const restarted=createMarketService({db});assert.equal(restarted.status('p').jobStatus,'interrupted');assert.equal(restarted.status('p').sources.length,2);
 }finally{db.close()}
});
