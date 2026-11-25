import path from 'node:path';
import {existsSync} from 'node:fs';
import {searchAvito,AVITO_HOME} from './market-avito.mjs';
import {searchCian} from './market-cian.mjs';
import {chooseAvitoLandCategory,avitoFormDiagnostics} from './avito-navigation.mjs';
import {isIPRestriction} from '../src/market-access.mjs';

// Ordinary visible browser, dedicated Navigator profile. No personal browser
// profile, private endpoints, CAPTCHA handling or anti-detection settings.
export function publicMarketURL(value,source){
 const u=new URL(String(value));const domain=source==='Авито'?'avito.ru':'cian.ru';
 if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname===domain||u.hostname.endsWith('.'+domain)))throw Error('Недопустимый адрес источника.');
 return u.href;
}
const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
export function locationMatches(text,settlement,region){
 const words=normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
 const contains=value=>{const wanted=normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);return wanted.length>0&&words.some((_,i)=>wanted.every((w,j)=>words[i+j]===w));};
 return contains(settlement)&&contains(region);
}
export async function inspectAccessCheck(page){
 const title=typeof page.title==='function'?await page.title():'';
 if(isIPRestriction(title))return {kind:'ip_restriction',title:title.slice(0,160)};
 if(/доступ\s+(?:ограничен|запрещ[её]н)/i.test(title))return {kind:'challenge_title',title:title.slice(0,160)};
 if(/^(?:captcha|проверка доступа|проверка браузера)(?:\s|$)|access denied|verify you are human|checking your browser/i.test(title.trim()))return {kind:'challenge_title',title:title.slice(0,160)};
 const text=(await page.locator('body').innerText({timeout:3000})).slice(0,100000);
 if(isIPRestriction(text))return {kind:'ip_restriction',title:title.slice(0,160)};
 if(/доступ\s+(?:ограничен|запрещ[её]н)|подтвердите.{0,40}(?:человек|робот)|проверка\s+браузера|слишком много запросов|access denied|verify you are human/i.test(text))return {kind:'visible_challenge_text',title:title.slice(0,160)};
 const frames=page.locator('iframe[src*="captcha"], js-challenge-loader, #id_captcha_frame_div');
 for(let i=0;i<Math.min(await frames.count(),10);i++){
  const item=frames.nth(i);if(!await item.isVisible())continue;
  if(typeof item.getAttribute==='function'&&await item.getAttribute('aria-hidden')==='true')continue;
  const box=typeof item.boundingBox==='function'?await item.boundingBox():null;
  // Preloaded hidden frames and small background badges are not an active
  // challenge. Never interact with a visible challenge or solve it.
  if(box&&(box.width<120||box.height<70))continue;
  return {kind:'visible_challenge_element',title:title.slice(0,160)};
 }
 return null;
}
export const accessCheck=async page=>!!await inspectAccessCheck(page);
export async function denyAvitoGeolocation(context,page){
 if(typeof context.newCDPSession!=='function')return null;
 const session=await context.newCDPSession(page);
 try{for(const origin of ['https://www.avito.ru','https://avito.ru'])await session.send('Browser.setPermission',{origin,permission:{name:'geolocation'},setting:'denied'});return 'denied'}finally{await session.detach()}
}
export async function dismissGeolocationNotice(page){
 if(typeof page.getByRole!=='function')return false;
 const dialogs=page.getByRole('dialog').filter({hasText:/разреш.{0,60}(?:местоположен|геолокац)|(?:использовать|определить).{0,25}(?:ваше|текущее).{0,25}местоположен/i});
 for(let i=0;i<Math.min(await dialogs.count(),5);i++){
  const dialog=dialogs.nth(i);if(!await dialog.isVisible())continue;
  if(await clickVisible(dialog.getByRole('button',{name:/^(?:Не сейчас|Позже|Нет, спасибо|Не разрешать|Отклонить|Закрыть|Указать город вручную|Выбрать город вручную)$/i})))return true;
 }
 return false;
}
export async function readCianVisibleFacts(page,settlement){
 if(typeof page.evaluate!=='function')return {};
 return page.evaluate(({settlement})=>{
  const lines=(document.body?.innerText||'').split(/\n/).map(t=>t.trim()).filter(Boolean);
  function value(labels){for(let i=0;i<lines.length;i++)for(const label of labels){const line=lines[i];if(line===label||line===label+':')return (lines[i+1]||'').slice(0,150);if(line.startsWith(label+':'))return line.slice(label.length+1).trim().slice(0,150)}return ''}
  const usage=value(['Статус участка','Вид разрешенного использования','Вид разрешённого использования','Разрешенное использование','Разрешённое использование']);
  const area=value(['Площадь участка']);
  const cadastre=value(['Кадастровый номер']);
  const norm=t=>String(t||'').toLowerCase().replace(/ё/g,'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const wanted=norm(settlement),localOfferURLs=[];let cardsRecognized=false;
  for(const a of document.querySelectorAll('a[href*="/sale/suburban/"]')){
   const card=a.closest('article,[data-name="CardComponent"],[data-testid="offer-card"]');if(!card)continue;
   cardsRecognized=true;const words=norm(card.innerText);
   if(words.some((_,i)=>wanted.every((w,j)=>words[i+j]===w)))localOfferURLs.push(a.href);
  }
  return {usage,area,cadastre:/^\d{2}:\d{2}:\d{6,7}:\d+$/.test(cadastre)?cadastre:null,cardsRecognized,localOfferURLs:[...new Set(localOfferURLs)].slice(0,25)};
 },{settlement});
}
async function visible(loc){for(let i=0;i<Math.min(await loc.count(),30);i++){const item=loc.nth(i);if(await item.isVisible())return item}return null;}
async function clickVisible(loc){const item=await visible(loc);if(!item)return false;await item.click({timeout:5000});return true;}
function stageError(stage,message){return Object.assign(Error(message),{stage})}
export async function waitForAccessCheck(page,{waitMs=0,clock=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const deadline=clock()+Math.max(0,Math.min(10000,waitMs));let evidence=await inspectAccessCheck(page);
 while(evidence&&evidence.kind!=='ip_restriction'&&clock()<deadline){await pause(Math.min(400,deadline-clock()));evidence=await inspectAccessCheck(page)}
 if(evidence?.kind==='ip_restriction')throw Object.assign(stageError('ip_restricted','Источник ограничил доступ: проблема с IP. Получение цен остановлено.'),{accessEvidence:evidence});
 if(evidence)throw Object.assign(stageError('access_check','Видимая проверка доступа не исчезла после ожидания. Сбор остановлен; вкладка оставлена открытой.'),{accessEvidence:evidence});
}
const assertAccess=(page,options)=>waitForAccessCheck(page,options);
async function openAvitoLocation(page){
 const deadline=Date.now()+5000;
 do{
  if(await clickVisible(page.locator('[data-marker="search-form/region"], [data-marker="search-form/location"], [data-marker="search-form/location-picker"]')))return;
  for(const role of ['button','link','combobox'])if(await clickVisible(page.getByRole(role,{name:/^(?:Все регионы|Город или регион|Местоположение|Выбрать город|Изменить город|Выбрать регион)(?:\s|$)/i})))return;
  if(await visible(page.locator('input[placeholder*="город" i], input[placeholder*="регион" i]')))return;
  if(Date.now()>=deadline)break;await new Promise(resolve=>setTimeout(resolve,250));
 }while(Date.now()<=deadline);
 throw stageError('location_control','Не удалось распознать выбор города на Авито.');
}

// Public UI selectors are deliberately bounded. If the public form changes,
// fail explicitly instead of guessing a city ID or silently using another city.
export async function selectAvitoSearch(page,input,{accessWaitMs=10000}={}){
 await page.goto(AVITO_HOME,{waitUntil:'domcontentloaded',timeout:20000});
 await assertAccess(page,{waitMs:accessWaitMs});
 await dismissGeolocationNotice(page);
 // Follow the user's ordinary navigation: real estate -> land, then choose
 // the city explicitly. Only follow actual public links rendered by the site.
 await chooseAvitoLandCategory(page,{checkAccess:()=>assertAccess(page,{waitMs:accessWaitMs})});
 await page.waitForLoadState('domcontentloaded');await assertAccess(page,{waitMs:accessWaitMs});await dismissGeolocationNotice(page);
 await openAvitoLocation(page);
 const fields=page.locator('input[placeholder*="город" i], input[placeholder*="регион" i], input[data-marker*="location"][type="text"]');
 await fields.first().waitFor({state:'visible',timeout:5000}).catch(()=>{});
 const field=await visible(fields);
 if(!field)throw stageError('location_input','Не удалось распознать поле населённого пункта Авито.');
 await field.fill(input.settlement,{timeout:5000});
 // Wait for the public suggestions to render; no repeated HTTP requests.
 const suggestions=page.locator('[role="option"], [data-marker*="suggest"] button, [data-marker*="suggest"] li, [data-marker="popup-location/region/search/suggest"], [data-marker="popup-location/region/search-suggest"]');
 await suggestions.first().waitFor({state:'visible',timeout:7000}).catch(()=>{});
 const matches=[];
 for(let i=0;i<Math.min(await suggestions.count(),30);i++){
  const item=suggestions.nth(i);if(await item.isVisible()&&locationMatches(await item.innerText(),input.settlement,input.region))matches.push(item);
 }
 if(matches.length!==1)throw stageError('location_ambiguous','Авито не показал однозначный населённый пункт вместе с регионом. Поиск в другом месте не выполнялся.');
 await matches[0].click({timeout:5000});
 await clickVisible(page.getByRole('button',{name:/^(?:Показать|Применить|Выбрать)(?:\s|$)/i}));
 await dismissGeolocationNotice(page);
 await clickVisible(page.getByRole('button',{name:/^(?:Найти|Показать)(?:\s|$)/i}));
 await page.waitForLoadState('domcontentloaded');await assertAccess(page,{waitMs:accessWaitMs});
 const url=publicMarketURL(page.url(),'Авито');
 if(!new URL(url).pathname.includes('/zemelnye_uchastki'))throw stageError('category_unconfirmed','Авито не подтвердил страницу земельных участков.');
 return url;
}

export function createBrowserMarkets({root,launch,platform=process.platform,cianOptions={},avitoAccessWaitMs=10000}={}){
 let contextPromise;const active=new Set(),pages=new Map();
 async function context(){
  if(!contextPromise)contextPromise=(async()=>{
   let ctx;if(launch)ctx=await launch();else{
    const {chromium}=await import('playwright-core');const profile=path.join(root,'market-browser');
    const opts={headless:false,locale:'ru-RU',acceptDownloads:false,timeout:15000};
    if(platform==='win32'){
     try{ctx=await chromium.launchPersistentContext(profile,{...opts,channel:'msedge'})}
     catch{ctx=await chromium.launchPersistentContext(profile,{...opts,channel:'chrome'})}
    }else{
     const executablePath=['/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);
     if(!executablePath)throw Error('Установи Microsoft Edge или Google Chrome.');
     ctx=await chromium.launchPersistentContext(profile,{...opts,executablePath});
    }
   }
   ctx.on('close',()=>{contextPromise=undefined});return ctx;
  })().catch(e=>{contextPromise=undefined;throw e});
  return contextPromise;
 }
 async function run(source,input){
  const base={source,connected:false,listings:[],requests:0,checkedAt:new Date().toISOString(),limit:25,transport:'visible_browser'};
  if(active.has(source))return {...base,status:'busy',message:'Этот источник уже открыт для другого поиска.'};
  active.add(source);let page,requests=0,stage='browser_start',accessFailure;
  try{
   const ctx=await context();await pages.get(source)?.close().catch(()=>{});
   page=await ctx.newPage();pages.set(source,page);page.setDefaultTimeout(5000);
   if(source==='Авито'){stage='location_permission';base.geolocation=await denyAvitoGeolocation(ctx,page);}
   // Main-page navigation remains within the chosen public source, including redirects.
   await page.route('**/*',async route=>{
    // Playwright event callbacks run outside run()'s try/catch. A closed page
    // or detached frame must not become an unhandled rejection.
    try{
     if(route.request().isNavigationRequest()&&route.request().frame()===page.mainFrame()){
      try{publicMarketURL(route.request().url(),source)}catch{await route.abort();return}
     }await route.continue();
    }catch{await route.abort().catch(()=>{})}
   });
   const fetchImpl=async(value,options={})=>{
    options.signal?.throwIfAborted();requests++;stage='read_public_page';
    const target=publicMarketURL(value,source);
    const abort=()=>{page.close().catch(()=>{})};options.signal?.addEventListener('abort',abort,{once:true});
    try{
     const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:15000});
     publicMarketURL(page.url(),source);try{await assertAccess(page,{waitMs:source==='Авито'?Math.min(5000,avitoAccessWaitMs):0})}catch(e){accessFailure=e;throw e}
     const html=await page.content();if(Buffer.byteLength(html)>3000000)throw Error('Страница слишком большая для безопасного чтения.');
     const result=new Response(html,{status:response?.status()||200,headers:{'content-type':'text/html; charset=utf-8',...(response?.headers()['retry-after']?{'retry-after':response.headers()['retry-after']}: {})}});
     result.marketAccessChecked=true;
     if(source==='ЦИАН')result.marketFacts=await readCianVisibleFacts(page,input.settlement);
     return result;
    }catch(error){
     // An aborted goto reports "Target ... closed" because our abort callback
     // closes the page. Preserve the actual timeout instead of blaming the user.
     if(options.signal?.aborted)throw options.signal.reason;
     if(/Target (?:page|browser)|context or browser has been closed/i.test(error.message||''))throw stageError('browser_closed','Вкладка или окно поиска были закрыты до завершения.');
     throw error;
    }finally{options.signal?.removeEventListener('abort',abort)}
   };
   let searchURL=input.searchURL;
   if(source==='Авито'&&!searchURL){stage='select_location_category';requests++;searchURL=await selectAvitoSearch(page,input,{accessWaitMs:avitoAccessWaitMs});}
   const result=await(source==='Авито'?searchAvito:searchCian)({...input,searchURL},{...(source==='ЦИАН'?cianOptions:{}),fetchImpl});
   // Avito search cards may link to offers rather than contain complete facts.
   // Read at most 25 actual public offer links; never paginate or invent links.
   if(accessFailure&&result.listings?.length)return {...result,status:'partial',stage:accessFailure.stage||'access_check',...(accessFailure.stage==='ip_restricted'?{reason:'ip_restricted'}:{}),transport:'visible_browser',requests};
   if(accessFailure)throw accessFailure;
   if(source==='Авито'&&result.status==='schema_unknown'&&requests<=2){
    const links=await page.locator('a[href]').evaluateAll(items=>items.map(a=>a.href));
    const urls=[...new Set(links)].filter(url=>{try{return /\/zemelnye_uchastki\/[^/]+_\d+\/?$/.test(new URL(publicMarketURL(url,source)).pathname)}catch{return false}}).slice(0,25);
    const deadline=Date.now()+45000;const listings=[];
    for(const url of urls){if(Date.now()>deadline)break;const offer=await searchAvito({...input,searchURL:url},{fetchImpl});if(accessFailure)throw accessFailure;if(!['available','schema_unknown'].includes(offer.status))return {...offer,...base,requests,status:offer.status,message:offer.message};for(const item of offer.listings||[])if(!listings.some(a=>a.url===item.url))listings.push(item);}
    if(listings.length)return {...result,transport:'visible_browser',requests,listings,connected:true,status:'available',message:`Прочитано подтверждённых предложений Авито: ${listings.length}. Это цены объявлений.`};
   }
   return {...result,transport:'visible_browser',requests,...(source==='Авито'?{geolocation:base.geolocation}:{})};
  }catch(e){const uiDiagnostics=source==='Авито'&&page?await avitoFormDiagnostics(page):null;return {...base,requests,status:e.stage==='ip_restricted'?'denied':e.stage==='access_check'?'access_check':'automation_failed',stage:e.stage||stage,...(e.stage==='ip_restricted'?{reason:'ip_restricted'}:{}),...(e.accessEvidence?{accessEvidence:e.accessEvidence}:{}),...(uiDiagnostics?{uiDiagnostics}:{}),message:e.message||'Не удалось выполнить поиск в браузере.'};}
  finally{active.delete(source);/* Keep the visible page for reviewing the actual result. */}
 }
 return {avito:input=>run('Авито',input),cian:input=>run('ЦИАН',input)};
}
