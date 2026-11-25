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
