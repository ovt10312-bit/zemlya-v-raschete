import path from 'node:path';
import {existsSync} from 'node:fs';
import {searchAvito,AVITO_HOME} from './market-avito.mjs';
import {searchCian} from './market-cian.mjs';

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
export async function accessCheck(page){
 const text=(await page.locator('body').innerText({timeout:3000})).slice(0,100000);
 return /доступ\s+(?:ограничен|запрещ[её]н)|подтвердите.{0,40}(?:человек|робот)|проверка\s+браузера|слишком много запросов|access denied|captcha/i.test(text)||await page.locator('iframe[src*="captcha"], js-challenge-loader, #id_captcha_frame_div').count()>0;
}
async function visible(loc){for(let i=0;i<Math.min(await loc.count(),30);i++){const item=loc.nth(i);if(await item.isVisible())return item}return null;}
async function clickVisible(loc){const item=await visible(loc);if(!item)return false;await item.click({timeout:5000});return true;}
function stageError(stage,message){return Object.assign(Error(message),{stage})}
async function assertAccess(page){if(await accessCheck(page))throw stageError('access_check','Сайт показал проверку доступа. Автоматический сбор остановлен; окно браузера оставлено открытым.');}

// Public UI selectors are deliberately bounded. If the public form changes,
// fail explicitly instead of guessing a city ID or silently using another city.
export async function selectAvitoSearch(page,input){
 await page.goto(AVITO_HOME,{waitUntil:'domcontentloaded',timeout:20000});
 await assertAccess(page);
 const location=page.locator('[data-marker="search-form/region"], [data-marker="search-form/location"], [data-marker="search-form/location-picker"]');
 if(!await clickVisible(location)&&!await clickVisible(page.getByRole('button',{name:/Все регионы|Город или регион|Местоположение/i})))throw stageError('location_control','Не удалось распознать выбор города на Авито.');
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
 if(!await clickVisible(page.getByRole('link',{name:'Земельные участки',exact:true}))){
  await clickVisible(page.getByRole('link',{name:'Недвижимость',exact:true}));
  if(!await clickVisible(page.getByRole('link',{name:'Земельные участки',exact:true})))throw stageError('category_control','Не удалось распознать категорию «Земельные участки» на Авито.');
 }
 await page.waitForLoadState('domcontentloaded');await assertAccess(page);
 const url=publicMarketURL(page.url(),'Авито');
 if(!new URL(url).pathname.includes('/zemelnye_uchastki'))throw stageError('category_unconfirmed','Авито не подтвердил страницу земельных участков.');
 return url;
}

export function createBrowserMarkets({root,launch,platform=process.platform}={}){
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
     publicMarketURL(page.url(),source);try{await assertAccess(page)}catch(e){accessFailure=e;throw e}
     const html=await page.content();if(Buffer.byteLength(html)>3000000)throw Error('Страница слишком большая для безопасного чтения.');
     return new Response(html,{status:response?.status()||200,headers:{'content-type':'text/html; charset=utf-8',...(response?.headers()['retry-after']?{'retry-after':response.headers()['retry-after']}: {})}});
    }finally{options.signal?.removeEventListener('abort',abort)}
   };
   let searchURL=input.searchURL;
   if(source==='Авито'&&!searchURL){stage='select_location_category';requests++;searchURL=await selectAvitoSearch(page,input);}
   const result=await(source==='Авито'?searchAvito:searchCian)({...input,searchURL},{fetchImpl});
   // Avito search cards may link to offers rather than contain complete facts.
   // Read at most 25 actual public offer links; never paginate or invent links.
   if(accessFailure)throw accessFailure;
   if(source==='Авито'&&result.status==='schema_unknown'&&requests<=2){
    const links=await page.locator('a[href]').evaluateAll(items=>items.map(a=>a.href));
    const urls=[...new Set(links)].filter(url=>{try{return /\/zemelnye_uchastki\/[^/]+_\d+\/?$/.test(new URL(publicMarketURL(url,source)).pathname)}catch{return false}}).slice(0,25);
    const deadline=Date.now()+45000;const listings=[];
    for(const url of urls){if(Date.now()>deadline)break;const offer=await searchAvito({...input,searchURL:url},{fetchImpl});if(accessFailure)throw accessFailure;if(!['available','schema_unknown'].includes(offer.status))return {...offer,...base,requests,status:offer.status,message:offer.message};for(const item of offer.listings||[])if(!listings.some(a=>a.url===item.url))listings.push(item);}
    if(listings.length)return {...result,transport:'visible_browser',requests,listings,connected:true,status:'available',message:`Прочитано подтверждённых предложений Авито: ${listings.length}. Это цены объявлений.`};
   }
   return {...result,transport:'visible_browser',requests};
  }catch(e){return {...base,requests,status:e.stage==='access_check'?'access_check':'automation_failed',stage:e.stage||stage,message:e.message||'Не удалось выполнить поиск в браузере.'};}
  finally{active.delete(source);/* Keep the visible page for reviewing the actual result. */}
 }
 return {avito:input=>run('Авито',input),cian:input=>run('ЦИАН',input)};
}
