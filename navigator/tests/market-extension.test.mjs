import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createMarketService} from '../server/market-service.mjs';
const parcel={id:'p',settlement:'Кондрово',region:'Калужская область',usage:'ИЖС'};
const card={title:'Участок 30 соток, ИЖС',url:'https://www.avito.ru/kondrovo/zemelnye_uchastki/uchastok_123456789',location:'Кондрово, Калужская область',price:900000,currency:'RUB',usageText:'ИЖС'};
const payload={status:'completed',searchURL:'https://www.avito.ru/kondrovo/zemelnye_uchastki',locationSelected:true,cards:[card]};
test('extension import validates cards server-side and preserves fresh Cian prices without another network call',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;const service=createMarketService({db,cian:async()=>{calls++;return {source:'ЦИАН',status:'available',listings:[{id:'c1',price:1}]}}});
 try{await service.search(parcel,{source:'cian'});const r=service.importBrowser(parcel,payload);assert.equal(calls,1);assert.equal(r.sources[0].listings[0].area,30);assert.equal(r.sources[0].listings[0].collectionMethod,'browser_extension');assert.equal(r.sources[1].listings[0].id,'c1');assert.equal(r.sources[1].notRequested,true);assert.equal(service.status('p').sources[0].listings.length,1)}finally{db.close()}
});
test('extension input cannot insert unverified listings, other cities, unsupported URLs or more than25 cards',()=>{
 const db=new DatabaseSync(':memory:');const service=createMarketService({db});
 try{
  for(const searchURL of ['file:///etc/passwd','https://evil.example/zemelnye_uchastki','https://user:pass@www.avito.ru/zemelnye_uchastki'])assert.throws(()=>service.importBrowser(parcel,{...payload,searchURL}));
  assert.throws(()=>service.importBrowser(parcel,{...payload,cards:Array(26).fill(card)}));
  const r=service.importBrowser(parcel,{...payload,cards:[{...card,location:'Калуга, Калужская область'},{...card,url:card.url+'1',price:0},{...card,url:card.url+'2',currency:'USD'}]});assert.equal(r.sources[0].listings.length,0);assert.equal(r.sources[0].connected,false);
  const denied=service.importBrowser(parcel,{...payload,status:'denied',cards:[card],message:'Доступ ограничен'});assert.equal(denied.sources[0].status,'denied');assert.equal(denied.sources[0].listings.length,0);
 }finally{db.close()}
});
