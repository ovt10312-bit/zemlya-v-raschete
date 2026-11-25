import {nodeFetch} from './node-fetch.mjs';
// Current Avito markup/API access has NOT been verified from the development
// network. This adapter reads one explicitly supplied public search page and
// accepts only self-describing schema.org offers with enough comparable facts.
// It does not guess private endpoints, city IDs, pagination or radius queries.
export const AVITO_HOME='https://www.avito.ru/';
export const AVITO_API_CATALOG='https://www.avito.ru/developers/api-catalog';
const HOSTS=new Set(['avito.ru','www.avito.ru']);
const MAX_BYTES=3000000,MAX_OFFERS=25;
const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/^(?:г\.?|город|п\.?|пос\.?|поселок|деревня|д\.?)\s+/,'').replace(/\s+/g,' ').trim();
function urlOf(value,base){const u=new URL(value,base);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.port||u.username||u.password)throw Error('Разрешены только публичные HTTPS-страницы Авито.');u.hash='';return u;}
function amount(value){if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;if(typeof value!=='string'||!/^\s*\d[\d\s\u00a0]*(?:[.,]\d+)?\s*$/.test(value))return null;const n=Number(value.replace(/[\s\u00a0]/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null;}
function typeOf(item,type){return [item?.['@type']].flat().some(t=>String(t).split(/[\/#]/).at(-1)===type);}
function usageOf(value){const t=String(value||'');if(/полев[а-яё]*\s+лпх/i.test(t))return null;const found=[];if(/(?:^|[^\p{L}])ижс(?:$|[^\p{L}])|индивидуальн[а-яё]*\s+жилищн/iu.test(t))found.push('ИЖС');if(/(?:^|[^\p{L}])лпх(?:$|[^\p{L}])|личн[а-яё]*\s+подсобн/iu.test(t))found.push('ЛПХ');if(/садоводств|(?:^|[^\p{L}])(?:снт|днп)(?:$|[^\p{L}])/iu.test(t))found.push('Садоводство');return found.length===1?found[0]:null;}
function explicitUsage(value){const s=normalize(value);if(s==='ижс')return 'ИЖС';if(s==='лпх'||s==='приусадебное лпх')return 'ЛПХ';if(s==='садоводство')return 'Садоводство';return null;}
function areaValue(value,unit){const n=amount(value);if(!n)return null;const u=normalize(unit).replace(/\s/g,'');if(/^(?:м²|м2|кв\.?м|mtk)$/.test(u))return n;if(/^(?:сот\.?|сотка|сотки|соток)$/.test(u))return n*100;if(/^(?:га|гектар|гектаров|har)$/.test(u))return n*10000;return null;}
function areaText(value){const m=String(value||'').match(/(\d+(?:[.,]\d+)?)\s*(сот(?:ок|ка|ки|\.)?|м[²2]|кв\.?\s*м|га)(?:\s|[(),.;]|$)/iu);return m?areaValue(m[1],m[2]):null;}
function coordinates(value){if(value?.latitude==null||value?.longitude==null||String(value.latitude).trim()===''||String(value.longitude).trim()===''||typeof value.latitude==='boolean'||typeof value.longitude==='boolean')return null;const lat=Number(value.latitude),lng=Number(value.longitude);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;}
function centerOf(value){if(!value||value.lat==null||value.lng==null)return null;return coordinates({latitude:value.lat,longitude:value.lng});}
function distanceKm(a,b){const rad=Math.PI/180,dlat=(a.lat-b.lat)*rad,dlng=(a.lng-b.lng)*rad,h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
function properties(item){return [item?.additionalProperty].flat().filter(v=>v&&typeof v==='object');}
function landURL(value,base){try{const u=urlOf(value,base);if(!/\/zemelnye_uchastki\/[^/]+_\d+\/?$/.test(u.pathname))return null;u.search='';u.pathname=u.pathname.replace(/\/$/,'');return u.href}catch{return null;}}
function rejection(reason){return {reason};}
function candidate(item,base,input,checkedAt){
 const offer=[item.offers].flat().find(o=>o&&typeof o==='object'&&!typeOf(o,'AggregateOffer')&&o.price!=null);
 if(!offer)return rejection('missing_exact_offer');
 const url=landURL(item.url||offer.url||item['@id'],base);if(!url)return rejection('missing_land_offer_url');
 const title=String(item.name||''),props=properties(item),propertyType=props.find(p=>/тип недвижимости|вид объекта/i.test(p.name||''))?.value;
 if(!/^(?:земельный\s+)?участок(?=\s|$|[,.:(])/iu.test(title)&&!/земельный\s+участок/iu.test(String(propertyType||'')))return rejection('unverified_land_type');
 const price=amount(offer.price);if(price===null||String(offer.priceCurrency||'').toUpperCase()!=='RUB')return rejection('missing_ruble_price');
 const areaProp=props.find(p=>/площадь\s+(?:земельного\s+)?участка/i.test(p.name||''));
 const areaM2=areaValue(item.lotSize?.value,item.lotSize?.unitText||item.lotSize?.unitCode)||areaValue(areaProp?.value,areaProp?.unitText||areaProp?.unitCode)||areaText(areaProp?.value)||areaText(title);
 if(areaM2===null||areaM2<input.areaMinM2||areaM2>input.areaMaxM2)return rejection('area_not_comparable');
 const usageEvidence=[title,...props.filter(p=>/назначени|разрешенн|тип участка/i.test(p.name||'')).map(p=>p.value)].join(' · '),usage=usageOf(usageEvidence);
 if(!usage||usage!==input.usage)return rejection('usage_not_verified_or_different');
 const address=item.address||item.location?.address,settlement=typeof address?.addressLocality==='string'?address.addressLocality.trim():'';
 const region=typeof address?.addressRegion==='string'?address.addressRegion.trim():'';if(!settlement)return rejection('missing_actual_settlement');
 const geo=coordinates(item.geo||item.location?.geo),center=centerOf(input.center),distance=geo&&center?distanceKm(geo,center):null;
 if(input.region&&normalize(region)!==normalize(input.region)&&!(region===''&&distance!==null&&distance<=20))return rejection('region_not_verified_or_different');
 const sameSettlement=normalize(settlement)===normalize(input.settlement);let geographicTier='settlement';
 if(!sameSettlement){if(distance===null||distance>20)return rejection('outside_verified_radius');geographicTier=distance<=10?'within_10km':'within_20km';}
 else if(distance!==null&&distance>20)return rejection('contradictory_location');
 return {listing:{id:url.match(/_(\d+)$/)[1],source:'Авито',sourceKind:'asking_price',url,title,price,currency:'RUB',areaM2,area:areaM2/100,usage,usageEvidence:usageEvidence.slice(0,500),settlement,region,address:typeof address?.streetAddress==='string'?address.streetAddress:'',coordinates:geo,distanceKm:distance===null?null:Math.round(distance*100)/100,geographicTier,sourceCheckedAt:checkedAt,date:checkedAt.slice(0,10),dateKind:'observed',publishedAt:typeof item.datePublished==='string'&&!Number.isNaN(Date.parse(item.datePublished))&&Date.parse(item.datePublished)<=Date.parse(checkedAt)?item.datePublished:null}};
}
function parseJSONLD(html){
 const roots=[];let scripts=0;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){if(!/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?:\s|$))/i.test(m[1]))continue;scripts++;try{roots.push(JSON.parse(m[2]))}catch{}}
 const items=[];let visited=0;
 function visit(value,depth=0){if(++visited>10000||depth>20||items.length>=100)return;if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return}if(!value||typeof value!=='object')return;if(typeOf(value,'Product')||typeOf(value,'RealEstateListing'))items.push(value);for(const key of ['@graph','itemListElement','item','itemOffered','mainEntity'])if(value[key])visit(value[key],depth+1);}
 for(const root of roots)visit(root);return {items,scripts};
}
export function extractAvitoJSONLD(html,input,{checkedAt=new Date().toISOString(),baseURL=AVITO_HOME}={}){
 const parsed=parseJSONLD(html),seen=new Set(),listings=[],rejected={};let inspectedCount=0;
 for(const item of parsed.items){const url=landURL(item.url||item.offers?.url||item['@id'],baseURL);if(!url||seen.has(url))continue;seen.add(url);if(inspectedCount>=input.limit)break;inspectedCount++;
  const result=candidate(item,baseURL,input,checkedAt);if(result.listing)listings.push(result.listing);else rejected[result.reason]=(rejected[result.reason]||0)+1;
 }
 const priority={settlement:0,within_10km:1,within_20km:2};listings.sort((a,b)=>priority[a.geographicTier]-priority[b.geographicTier]||(a.distanceKm||0)-(b.distanceKm||0));
 return {listings:listings.slice(0,input.limit),inspectedCount,rejected,jsonLDScripts:parsed.scripts};
}
function challenge(html){const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';const visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<[^>]*>/g,' ');return /(captcha|access denied|доступ\s+ограничен|доступ\s+запрещен|проверка\s+браузера|подтвердите.{0,40}(?:человек|робот)|слишком много запросов)/i.test(title+' '+visible);}
function retryAt(value,now){const sec=Number(value),date=Date.parse(value||'');return new Date(Math.max(now+30000,sec>0?now+sec*1000:Number.isFinite(date)?date:now+60000)).toISOString();}
function optionsOf(input={}){
 const settlement=String(input.settlement||'').trim(),usage=explicitUsage(input.usage),areaMinM2=Number(input.areaMinM2??600),areaMaxM2=Number(input.areaMaxM2??2000),limit=Number(input.limit??25);
 if(!settlement||settlement.length>200||!usage||!Number.isFinite(areaMinM2)||!Number.isFinite(areaMaxM2)||areaMinM2<600||areaMaxM2>2000||areaMinM2>areaMaxM2||!Number.isInteger(limit)||limit<1||limit>25)throw Error('Укажи населённый пункт, назначение, площадь 600–2000 м² и лимит до 25 объявлений.');
 return {...input,settlement,region:String(input.region||'').trim(),usage,areaMinM2,areaMaxM2,limit};
}
async function readPage(url,{fetchImpl,clock,timeoutMs=10000,maxBytes=MAX_BYTES}){
 let current=urlOf(url),requests=0;const signal=AbortSignal.timeout(Math.max(1,Math.min(15000,timeoutMs)));
 while(requests<3){requests++;const response=await fetchImpl(current,{headers:{accept:'text/html'},credentials:'omit',redirect:'manual',signal});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Авито вернул перенаправление без адреса.');current=urlOf(location,current);continue;}
  const metadata={url:current.href,requests,httpStatus:response.status};
  if(!response.ok){await response.body?.cancel();return {...metadata,status:response.status===429?'limited':response.status===403?'denied':'unavailable',...(response.status===429?{retryAt:retryAt(response.headers.get('retry-after'),clock())}:{})};}
  const reader=response.body?.getReader();if(!reader)throw Error('Пустой ответ Авито.');const chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>Math.min(MAX_BYTES,maxBytes)){await reader.cancel();throw Error('Страница Авито превышает допустимый размер.');}chunks.push(value)}}finally{reader.releaseLock()}
  return {...metadata,status:'page_received',html:new TextDecoder().decode(Buffer.concat(chunks)),bytes,visibilityChecked:response.marketAccessChecked===true};
 }
 throw Error('Слишком много перенаправлений Авито.');
}
export async function searchAvito(input,options={}){
 const clock=options.clock||Date.now,checkedAt=new Date(clock()).toISOString();let request;
 const base={source:'Авито',checkedAt,listings:[],connected:false,limit:25,requests:0,radiusExpansionPerformed:false,coverage:'one_explicit_public_search_page'};
 try{request=optionsOf(input)}catch(e){return {...base,status:'invalid_request',message:e.message}}
 const result={...base,limit:request.limit};
 if(!request.searchURL)return {...result,status:'schema_unknown',reason:'missing_search_url',searchURL:AVITO_HOME,message:'Автоматический поиск Авито ещё не подтверждён. Нужна реальная публичная ссылка на выдачу; адреса городов и закрытые API не подставляются.'};
 try{
  const page=await readPage(request.searchURL,{...options,fetchImpl:options.fetchImpl||nodeFetch,clock});const metadata={...result,requests:page.requests,httpStatus:page.httpStatus,searchURL:page.url};
  if(page.status!=='page_received')return {...metadata,status:page.status,...(page.retryAt?{retryAt:page.retryAt}:{}),message:`Авито вернул HTTP ${page.httpStatus}. Рыночные цены не получены.`};
  if(!page.visibilityChecked&&challenge(page.html))return {...metadata,status:'denied',reason:'access_check',message:'Авито показал проверку доступа. Сбор остановлен, цены не получены.'};
  const extracted=extractAvitoJSONLD(page.html,request,{checkedAt,baseURL:page.url});
  return {...metadata,...extracted,status:extracted.listings.length?'available':'schema_unknown',connected:extracted.listings.length>0,message:extracted.listings.length?`Прочитано подтверждённых предложений Авито: ${extracted.listings.length}. Это цены объявлений; сведения соседних населённых пунктов сохранены отдельно.`:'В полученной странице не найдены подходящие предложения с подтверждёнными ценой, площадью, назначением и местом. Текущий формат Авито не подтверждён; это не означает отсутствие объявлений.'};
 }catch(e){return {...result,status:e.name==='TimeoutError'?'timeout':'unavailable',message:e.name==='TimeoutError'?'Авито не ответил вовремя. Рыночные цены не получены.':'Получение Авито недоступно: '+e.message}}
}
export async function probeAvito(options={}){
 const clock=options.clock||Date.now,checkedAt=new Date(clock()).toISOString(),base={source:'Авито',checkedAt,listings:[],connected:false,requests:0,searchURL:AVITO_HOME};
 try{const page=await readPage(AVITO_HOME,{...options,fetchImpl:options.fetchImpl||nodeFetch,clock});const metadata={...base,requests:page.requests,httpStatus:page.httpStatus};if(page.status!=='page_received')return {...metadata,status:page.status,...(page.retryAt?{retryAt:page.retryAt}:{}),message:`Авито вернул HTTP ${page.httpStatus}. Доступ к объявлениям не подтверждён.`};return {...metadata,status:challenge(page.html)?'denied':'schema_unknown',message:'Страница Авито ответила; получение сопоставимых объявлений ещё не подтверждено.'}}catch(e){return {...base,status:e.name==='TimeoutError'?'timeout':'unavailable',message:'Не удалось проверить Авито: '+e.message}}
}
