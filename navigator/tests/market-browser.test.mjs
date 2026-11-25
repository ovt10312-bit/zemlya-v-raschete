import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserMarkets,locationMatches,publicMarketURL,selectAvitoSearch} from '../server/market-browser.mjs';

const input={settlement:'Кондрово',region:'Калужская область',usage:'ИЖС',limit:25};
test('browser location selection requires complete city and region, not a substring',()=>{
 assert.equal(locationMatches('г. Кондрово, Калужская область','Кондрово','Калужская область'),true);
 assert.equal(locationMatches('Новокондрово, Калужская область','Кондрово','Калужская область'),false);
 assert.equal(locationMatches('Кондрово, другой регион','Кондрово','Калужская область'),false);
 assert.equal(locationMatches('Кондрово','Кондрово',''),false);
});
test('browser only navigates public HTTPS pages of the selected source',()=>{
 assert.equal(publicMarketURL('https://kaluga.cian.ru/sale/suburban/12/','ЦИАН'),'https://kaluga.cian.ru/sale/suburban/12/');
 for(const value of ['file:///etc/passwd','http://avito.ru/','https://avito.ru.evil.example/','https://user:secret@avito.ru/','https://cian.ru/'])assert.throws(()=>publicMarketURL(value,'Авито'));
});
test('a missing local browser is an explicit failure, not missing offers',async()=>{
 const market=createBrowserMarkets({launch:async()=>{throw Error('Browser unavailable')}});
 const result=await market.avito(input);assert.equal(result.status,'automation_failed');assert.equal(result.stage,'browser_start');assert.equal(result.requests,0);assert.equal(result.connected,false);
});

function fakeBrowser({body='',html='<html></html>'}={}){
 let launches=0,navigations=0,closeCount=0;
 const pages=[];
 const launch=async()=>{launches++;return {on(){},async newPage(){let url='about:blank';const page={
  setDefaultTimeout(){},async route(pattern,callback){page.routeHandler=callback},async goto(value){navigations++;url=value;return {status:()=>200,headers:()=>({})}},url:()=>url,
  locator(selector){return {innerText:async()=>body,count:async()=>0,evaluateAll:async()=>[]}},async content(){return html},async close(){closeCount++}
 };pages.push(page);return page}}};
 return {launch,pages,stats:()=>({launches,navigations,closeCount,pages:pages.length})};
}
test('browser challenge stops the first Cian request without trying other pages',async()=>{
 const browser=fakeBrowser({body:'Подтвердите, что вы человек'});const market=createBrowserMarkets({launch:browser.launch});
 const result=await market.cian(input);assert.equal(result.status,'access_check');assert.equal(result.requests,1);assert.equal(result.connected,false);assert.equal(browser.stats().navigations,1);assert.equal(browser.stats().closeCount,0);
});
test('repeated searches reuse one dedicated browser and replace only owned source tab',async()=>{
 const browser=fakeBrowser();const market=createBrowserMarkets({launch:browser.launch});
 const first=await market.avito({...input,searchURL:'https://www.avito.ru/kondrovo/zemelnye_uchastki'});
 assert.equal(first.status,'schema_unknown');assert.equal(first.requests,1);
 await market.avito({...input,searchURL:'https://www.avito.ru/kondrovo/zemelnye_uchastki'});
 assert.deepEqual(browser.stats(),{launches:1,navigations:2,closeCount:1,pages:2});
});
test('automatic Avito flow starts at the real homepage and stops on challenge before UI clicks',async()=>{
 const browser=fakeBrowser({body:'Доступ ограничен'});const ctx=await browser.launch();const page=await ctx.newPage();
 await assert.rejects(selectAvitoSearch(page,input),error=>error.stage==='access_check');
 assert.equal(page.url(),'https://www.avito.ru/');assert.equal(browser.stats().navigations,1);
});
test('automatic Avito flow selects the exact region and follows the actual category link',async()=>{
 let url='',chosen='',typed='';
 const list=items=>({count:async()=>items.length,nth:i=>items[i],first:()=>({waitFor:async()=>{}})});
 const button=action=>({isVisible:async()=>true,click:async()=>action(),innerText:async()=>''});
 const options=['Кондрово, другой регион','Кондрово, Калужская область'].map(text=>({...button(()=>{chosen=text}),innerText:async()=>text}));
 const field={isVisible:async()=>true,fill:async value=>{typed=value}};
 const page={
  async goto(value){url=value},url:()=>url,async waitForLoadState(){},
  locator(selector){
   if(selector==='body')return {innerText:async()=>''};
   if(selector.startsWith('iframe'))return list([]);
   if(selector.startsWith('input'))return list([field]);
   if(selector.startsWith('[role="option"]'))return list(options);
   return list([button(()=>{})]);
  },
  getByRole(role,{name}){return role==='link'&&name==='Земельные участки'?list([button(()=>{url='https://www.avito.ru/public-location-from-site/zemelnye_uchastki'})]):list([])}
 };
 const result=await selectAvitoSearch(page,input);
 assert.equal(typed,'Кондрово');assert.equal(chosen,'Кондрово, Калужская область');assert.equal(result,'https://www.avito.ru/public-location-from-site/zemelnye_uchastki');
});
test('the visible browser passes published facts to the strict price parser',async()=>{
 const payload={'@type':'Product',name:'Участок 10 соток, ИЖС',url:'https://www.avito.ru/kondrovo/zemelnye_uchastki/uchastok_123456789',address:{addressLocality:'Кондрово',addressRegion:'Калужская область'},offers:{price:900000,priceCurrency:'RUB'}};
 const browser=fakeBrowser({html:'<script type="application/ld+json">'+JSON.stringify(payload)+'</script>'});
 const result=await createBrowserMarkets({launch:browser.launch}).avito({...input,searchURL:'https://www.avito.ru/kondrovo/zemelnye_uchastki'});
 assert.equal(result.status,'available',result.message);assert.equal(result.listings[0].price,900000);assert.equal(result.listings[0].areaM2,1000);assert.equal(result.listings[0].quarterCadastre,undefined);assert.equal(result.transport,'visible_browser');
});
test('closed-page route callbacks do not escape as unhandled rejections',async()=>{
 const browser=fakeBrowser();await createBrowserMarkets({launch:browser.launch}).avito({...input,searchURL:'https://www.avito.ru/kondrovo/zemelnye_uchastki'});
 const handler=browser.pages[0].routeHandler;
 await assert.doesNotReject(handler({request:()=>({isNavigationRequest:()=>false}),continue:async()=>{throw Error('Target page has been closed')},abort:async()=>{throw Error('Target closed too')}}));
 await assert.doesNotReject(handler({request:()=>{throw Error('Detached frame')},abort:async()=>{throw Error('Closed')}}));
});
