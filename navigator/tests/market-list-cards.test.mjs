import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAvitoCards,searchAvito} from '../server/market-avito.mjs';
const input={settlement:'Кондрово',region:'Калужская область',usage:'ИЖС',limit:25};
const card={title:'Участок 30 соток, ИЖС',url:'https://www.avito.ru/kondrovo/zemelnye_uchastki/uchastok_123456789',address:{addressLocality:'Кондрово',addressRegion:'Калужская область'},price:900000,currency:'RUB',usageText:'ИЖС'};
test('result-card extraction accepts sizes outside formation range and enforces usage and location evidence',()=>{
 const result=extractAvitoCards([card,{...card,url:card.url+'1',address:{}},{...card,url:card.url+'2',usageText:'ЛПХ',title:'Участок 30 соток, ЛПХ'},{...card,url:card.url+'3',price:0}],input);
 assert.equal(result.listings.length,1);assert.equal(result.listings[0].area,30);assert.equal(result.listings[0].price,900000);
});
test('result-card extraction limits inspection to25 unique cards',()=>{
 const cards=Array.from({length:30},(_,i)=>({...card,url:card.url+i}));const result=extractAvitoCards(cards,input);assert.equal(result.listings.length,25);assert.equal(result.inspectedCount,25);
});
test('browser-supplied visible cards are parsed with one request and no detail loading',async()=>{
 let requests=0;const result=await searchAvito({...input,searchURL:'https://www.avito.ru/kondrovo/zemelnye_uchastki'},{fetchImpl:async()=>{requests++;const r=new Response('<html></html>');r.marketAccessChecked=true;r.marketCards=[card];return r}});
 assert.equal(requests,1);assert.equal(result.status,'available');assert.equal(result.listings[0].area,30);
});
