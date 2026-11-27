import test from 'node:test';
import assert from 'node:assert/strict';
import {requestMarket} from '../src/market-client.mjs';
test('lost market response has a readable local-server error and never automatically repeats POST',async()=>{
 let requests=0;await assert.rejects(requestMarket({parcelId:'p',body:{parcelId:'p'},fetchImpl:async()=>{requests++;throw TypeError('Failed to fetch')}}),/Потеряна связь с локальным сервером/);assert.equal(requests,1);
});
test('market client reads saved background state and preserves explicit server errors',async()=>{
 const calls=[];const result=await requestMarket({parcelId:'p /',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({jobStatus:'running'})}});
 assert.equal(result.jobStatus,'running');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].url,'/api/market?parcelId=p%20%2F');
 await assert.rejects(requestMarket({parcelId:'p',fetchImpl:async()=>Response.json({error:'Получение цен уже идёт.'},{status:400})}),/уже идёт/);
});

test('every market POST carries the selected parcel id, including automatic Cian and extension results',async()=>{
 for(const body of [{source:'cian'},{action:'browserResult',result:{status:'completed',cards:[]}},{parcelId:'stale-card',source:'all'}]){
  let received;
  await requestMarket({parcelId:'formation-current',body,fetchImpl:async(url,options)=>{received={url,method:options.method,body:JSON.parse(options.body)};return Response.json({jobStatus:'completed'})}});
  assert.equal(received.url,'/api/market');assert.equal(received.method,'POST');assert.equal(received.body.parcelId,'formation-current');assert.equal(received.body.source,body.source);assert.equal(received.body.action,body.action);assert.deepEqual(received.body.result,body.result);
 }
});
