import test from 'node:test';
import assert from 'node:assert/strict';
import {searchCian} from '../server/market-cian.mjs';
import {createBrowserMarkets,readCianVisibleFacts} from '../server/market-browser.mjs';
const url='https://kaluga.cian.ru/sale/suburban/302835757/';
const input={settlement:'Кондрово',region:'Калужская область',usage:'ИЖС',searchURL:url};
const title='Продажа участка 12сот. ул. Стефанова, Кондрово, Калужская область, Дзержинский район - база ЦИАН, объявление 302835757';
function product(overrides={}){return {'@type':'Product',name:'Купить участок',offers:{price:900000,priceCurrency:'RUB',availability:'https://schema.org/InStock',url},...overrides}}
function html(node,heading=title){return '<title>'+heading+'</title><script type="application/ld+json">'+JSON.stringify(node)+'</script>'}
const facts={usage:'Индивидуальное жилищное строительство',area:'12 сот.',cadastre:'40:04:010101:123'};
function response(body,visible=facts){const r=new Response(body);r.marketFacts=visible;return r}
test('current offer title and named visible fields can complete missing JSON-LD facts',async()=>{
 const r=await searchCian(input,{fetchImpl:async()=>response(html(product()))});
 assert.equal(r.status,'available',r.message);assert.equal(r.listings.length,1);assert.equal(r.listings[0].price,900000);assert.equal(r.listings[0].areaM2,1200);assert.equal(r.listings[0].usage,'ИЖС');assert.equal(r.listings[0].quarterCadastre,'40:04:010101');assert.ok(r.listings[0].provenance.publicEvidence.includes('individual_page_title_location'));
});
test('current offer page does not donate facts to unrelated embedded recommendations',async()=>{
 const other=product({offers:{price:900000,priceCurrency:'RUB',availability:'https://schema.org/InStock',url:'https://kaluga.cian.ru/sale/suburban/999999/'}});
 const r=await searchCian(input,{maxRequests:1,fetchImpl:async()=>response(html(other))});assert.equal(r.listings.length,0);assert.ok(r.rejected.area_missing);
});
test('explicit conflicting address and ambiguous usage are rejected rather than overwritten',async()=>{
 for(const node of [product({address:{addressLocality:'Грачевка',addressRegion:'Калужская область'}}),product({description:'Для ведения личного подсобного хозяйства'})]){
  const r=await searchCian(input,{fetchImpl:async()=>response(html(node))});assert.equal(r.listings.length,0);assert.ok(r.rejected.different_settlement||r.rejected.usage_unconfirmed);
 }
});
test('search page heading cannot supply address to incomplete structured search offers',async()=>{
 const r=await searchCian({...input,searchURL:'https://kaluga.cian.ru/search-public/'},{maxRequests:1,fetchImpl:async()=>response(html(product()))});assert.equal(r.listings.length,0);assert.ok(r.rejected.area_missing);
});
test('missing active status stays unconfirmed and structural diagnostics contain no description/contact fields',async()=>{
 const node=product({description:'Контакт: личный телефон не включать',offers:{price:900000,priceCurrency:'RUB',url}});
 const r=await searchCian(input,{fetchImpl:async()=>response(html(node))});assert.equal(r.listings.length,0);assert.equal(r.rejected.active_offer_unconfirmed,1);assert.equal(r.structuredSamples[0].rejectionReason,'active_offer_unconfirmed');assert.doesNotMatch(JSON.stringify(r.structuredSamples),/личный телефон/);
});
test('local card links with tracking queries exclude unrelated recommendations',async()=>{
 const visited=[];const r=await searchCian({...input,searchURL:'https://kaluga.cian.ru/search-public/'},{fetchImpl:async value=>{
  visited.push(String(value));if(visited.length===1)return response('<title>Земельные участки Кондрово</title><a href="'+url+'">В Кондрово</a><a href="https://kaluga.cian.ru/sale/suburban/999999/">Другой город</a>',{cardsRecognized:true,localOfferURLs:[url+'?tracking=card']});
  assert.equal(String(value),url);return response(html(product()));
 }});assert.equal(r.listings.length,1);assert.equal(visited.length,2);
});
test('visible field extraction reads named land facts without exporting raw body or contacts',async()=>{
 const previous=globalThis.document;globalThis.document={body:{innerText:'Телефон\n+7 123 456 78 90\nСтатус участка\nИндивидуальное жилищное строительство\nПлощадь участка\n12 сот.\nКадастровый номер\n40:04:010101:123'},querySelectorAll:()=>[]};
 try{const r=await readCianVisibleFacts({evaluate:async(fn,args)=>fn(args)},'Кондрово');assert.equal(r.usage,facts.usage);assert.equal(r.area,facts.area);assert.equal(r.cadastre,facts.cadastre);assert.doesNotMatch(JSON.stringify(r),/123 456|Телефон/)}finally{globalThis.document=previous}
});
function closingBrowser({selfClose=false}={}){
 let rejectGoto;const page={setDefaultTimeout(){},route:async()=>{},goto:async()=>{if(selfClose)throw Error('page.goto: Target page, context or browser has been closed');return new Promise((resolve,reject)=>{rejectGoto=reject})},close:async()=>rejectGoto?.(Error('page.goto: Target page, context or browser has been closed'))};
 return async()=>({on(){},newPage:async()=>page});
}
test('our abort-induced page closure is reported as timeout rather than browser closure',async()=>{
 const market=createBrowserMarkets({launch:closingBrowser(),cianOptions:{timeout:20}});const r=await market.cian(input);
 assert.equal(r.status,'timeout');assert.match(r.message,/лимит времени/);assert.doesNotMatch(r.message,/Target page|Call log|\u001b/);
});
test('real browser closure has a concise Russian result',async()=>{
 const market=createBrowserMarkets({launch:closingBrowser({selfClose:true})});const r=await market.cian(input);assert.equal(r.status,'browser_closed');assert.match(r.message,/Вкладка или окно поиска/);assert.doesNotMatch(r.message,/Target page|Call log/);
});
test('total budget expiry keeps already verified listings as a partial result',async()=>{
 let calls=0;const node=product({name:'Участок 12 сот., ИЖС',address:{addressLocality:'Кондрово',addressRegion:'Калужская область'}});
 const r=await searchCian(input,{totalTimeoutMs:1000,timeout:3000,fetchImpl:async(value,{signal})=>{
  if(!calls++)return new Response(html(node)+'<a href="https://kaluga.cian.ru/sale/suburban/999999/">Другое объявление</a>');
  return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});
 }});
 assert.equal(r.status,'partial');assert.equal(r.listings.length,1);assert.match(r.message,/лимит времени/);
});
