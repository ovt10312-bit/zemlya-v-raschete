import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {inspectAccessCheck,waitForAccessCheck} from '../server/market-browser.mjs';
import {createMarketService} from '../server/market-service.mjs';
import {isIPRestriction,isAvitoIPRestricted} from '../src/market-access.mjs';

test('the actual reported IP restriction is detected from title even with empty body',async()=>{
 const page={title:async()=> 'Доступ ограничен: проблема с IP',locator:()=>{throw Error('No body read needed')}};
 assert.equal((await inspectAccessCheck(page)).kind,'ip_restriction');
 await assert.rejects(waitForAccessCheck(page,{waitMs:10000,pause:async()=>{throw Error('Must not wait or retry')}}),e=>e.stage==='ip_restricted');
 assert.equal(isIPRestriction('Продаю участок с IP-камерой. Проблема с IP-камерой устранена.'),false);
 assert.equal(isIPRestriction('Доступ с вашего IP-адреса временно ограничен'),true);
});
test('a saved legacy category failure is correctly presented as the actual IP restriction',()=>{
 const db=new DatabaseSync(':memory:');try{
  const market=createMarketService({db});const saved={parcelId:'p',jobStatus:'completed',sources:[{source:'Авито',status:'automation_failed',stage:'category_control',message:'Category missing',uiDiagnostics:{title:'Доступ ограничен: проблема с IP'},listings:[]}]};
  db.prepare('INSERT INTO market_sources VALUES(?,?)').run('p',JSON.stringify(saved));const result=market.status('p');assert.equal(result.sources[0].status,'denied');assert.equal(result.sources[0].reason,'ip_restricted');assert.equal(isAvitoIPRestricted(result.sources[0]),true);assert.match(result.sources[0].message,/проблема с IP/);
 }finally{db.close()}
});
test('Cian can refresh independently and a deliberate Avito check preserves saved Cian prices',async()=>{
 const db=new DatabaseSync(':memory:');let avitoCalls=0,cianCalls=0,now=Date.now();
 const market=createMarketService({db,clock:()=>now,avito:async()=>{avitoCalls++;return {source:'Авито',status:'denied',reason:'ip_restricted',listings:[]}},cian:async()=>{cianCalls++;return {source:'ЦИАН',status:'available',listings:[{id:'c1',price:550000}]}}});
 const parcel={id:'p',settlement:'Кондрово'};
 try{
  await market.search(parcel);now+=31000;
  const next=await market.search(parcel,{source:'cian'});assert.equal(avitoCalls,1);assert.equal(cianCalls,2);assert.deepEqual(next.requestedSources,['ЦИАН']);assert.equal(next.sources.find(s=>s.source==='Авито').notRequested,true);
  now+=31000;const avitoOnly=await market.search(parcel,{source:'avito'});assert.equal(avitoCalls,2);assert.equal(cianCalls,2);const cian=avitoOnly.sources.find(s=>s.source==='ЦИАН');assert.equal(cian.notRequested,true);assert.equal(cian.listings[0].price,550000);
  now+=31000;assert.throws(()=>market.start(parcel,{source:'invalid'}),/Неизвестный источник/);await assert.rejects(market.search(parcel,{source:'invalid'}),/Неизвестный источник/);assert.equal(avitoCalls,2);assert.equal(cianCalls,2);
 }finally{db.close()}
});
