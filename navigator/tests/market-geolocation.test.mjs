import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAccessCheck,waitForAccessCheck,denyAvitoGeolocation,dismissGeolocationNotice,createBrowserMarkets} from '../server/market-browser.mjs';
import {marketOfferSummary} from '../src/market-summary.mjs';

function challengePage({text='',title='',frames=[]}={}){
 return {title:async()=>title,locator(selector){if(selector==='body')return {innerText:async()=>text};return {count:async()=>frames.length,nth:i=>({isVisible:async()=>frames[i].visible,getAttribute:async()=>frames[i].ariaHidden||null,boundingBox:async()=>frames[i].box||{width:300,height:200}})}}};
}
test('ordinary geolocation wording and hidden CAPTCHA preload are not an active challenge',async()=>{
 const r=await inspectAccessCheck(challengePage({text:'Авито — объявления. Разрешите Авито отображать ваше местоположение. Используется CAPTCHA для защиты форм.',frames:[{visible:false}]}));assert.equal(r,null);
 assert.equal(await inspectAccessCheck(challengePage({frames:[{visible:true,ariaHidden:'true'}]})),null);
 assert.equal(await inspectAccessCheck(challengePage({frames:[{visible:true,box:{width:256,height:60}}]})),null);
});
test('visible human checks and large visible challenge frames still stop automation',async()=>{
 assert.equal((await inspectAccessCheck(challengePage({text:'Подтвердите, что вы человек'}))).kind,'visible_challenge_text');
 assert.equal((await inspectAccessCheck(challengePage({title:'Captcha'}))).kind,'challenge_title');
 assert.equal((await inspectAccessCheck(challengePage({frames:[{visible:true}]}))).kind,'visible_challenge_element');
});
test('a temporary visible check is only observed and search can resume when it disappears',async()=>{
 let now=0,reads=0;const page=challengePage();page.locator=selector=>selector==='body'?{innerText:async()=>++reads<3?'Подтвердите, что вы человек':''}:{count:async()=>0};
 await waitForAccessCheck(page,{waitMs:10000,clock:()=>now,pause:async ms=>{now+=ms}});assert.equal(reads,3);assert.equal(now,800);
});
test('persistent visible check stops at the bounded deadline without clicks or reloads',async()=>{
 let now=0;await assert.rejects(waitForAccessCheck(challengePage({text:'Подтвердите, что вы человек'}),{waitMs:1000,clock:()=>now,pause:async ms=>{now+=ms}}),e=>e.stage==='access_check'&&e.accessEvidence.kind==='visible_challenge_text');assert.equal(now,1000);
});
test('geolocation is denied only for Avito, without granting or fabricating a position',async()=>{
 const calls=[];let detached=false;const context={newCDPSession:async()=>({send:async(method,args)=>calls.push({method,args}),detach:async()=>{detached=true}})};
 assert.equal(await denyAvitoGeolocation(context,{}),'denied');assert.equal(detached,true);assert.equal(calls.length,2);
 assert.deepEqual(calls.map(c=>c.args.origin),['https://www.avito.ru','https://avito.ru']);assert.ok(calls.every(c=>c.method==='Browser.setPermission'&&c.args.setting==='denied'&&c.args.permission.name==='geolocation'));
});
test('a geolocation notice is dismissed only through its normal decline/close control',async()=>{
 let clicked=false;const button={isVisible:async()=>true,click:async()=>{clicked=true}};
 const buttons={count:async()=>1,nth:()=>button};const dialog={isVisible:async()=>true,getByRole:()=>buttons};
 const page={getByRole:role=>{assert.equal(role,'dialog');return {filter:({hasText})=>{assert.match('Разрешите Авито отображать ваше местоположение',hasText);return {count:async()=>1,nth:()=>dialog}}}}};
 assert.equal(await dismissGeolocationNotice(page),true);assert.equal(clicked,true);
});
test('a rendered normal offer does not get rejected again for hidden CAPTCHA text in raw HTML',async()=>{
 const node={'@type':'Product',name:'Участок 10 соток, ИЖС',url:'https://www.avito.ru/kondrovo/zemelnye_uchastki/uchastok_123456789',address:{addressLocality:'Кондрово',addressRegion:'Калужская область'},offers:{price:900000,priceCurrency:'RUB'}};
 const body='<div hidden>captcha Подтвердите, что вы человек</div><script type="application/ld+json">'+JSON.stringify(node)+'</script>';
 const page={...challengePage(),setDefaultTimeout(){},route:async()=>{},goto:async()=>({status:()=>200,headers:()=>({})}),url:()=>node.url,content:async()=>body};
 const market=createBrowserMarkets({launch:async()=>({on(){},newPage:async()=>page})});const r=await market.avito({settlement:'Кондрово',region:'Калужская область',usage:'ИЖС',searchURL:node.url});assert.equal(r.status,'available',r.message);assert.equal(r.listings.length,1);
});
test('asking prices from the same settlement and usage are eligible regardless of quarter',()=>{
 const offers=Array.from({length:9},(_,i)=>({id:i,source:'ЦИАН',price:400000+i*10000,area:10,settlement:'Кондрово',usage:'ИЖС'}));
 const summary=marketOfferSummary([{source:'ЦИАН',listings:offers}],{origin:'formation',settlement:'Кондрово',usage:'ИЖС'});
 assert.equal(summary.collected.length,9);assert.equal(summary.eligible.length,9);
 const matched=marketOfferSummary([{listings:[{...offers[0],quarterCadastre:'40:04:010101'},{...offers[1],quarterCadastre:'40:04:010201'},offers[2]]}],{origin:'formation',settlement:'Кондрово',usage:'ИЖС',quarterCadastre:'40:04:010101'});
 assert.equal(matched.eligible.length,3);
 const other=marketOfferSummary([{listings:[{...offers[0],settlement:'Калуга'},{...offers[1],usage:'ЛПХ'},offers[2]]}],{origin:'formation',settlement:'Кондрово',usage:'ИЖС'});
 assert.equal(other.eligible.length,1);assert.equal(other.eligible[0].id,2);
});
