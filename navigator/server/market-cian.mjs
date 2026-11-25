import {nodeFetch} from './node-fetch.mjs';
// Ordinary public Cian pages only. No private API, credentials or challenge execution.
// Live verification on 22.11.2026 returned a Servicepipe JS challenge. The JSON-LD
// reader below is a supported declarative format, not a claim of live access.
export const CIAN_SOURCE='ЦИАН';
export const CIAN_KONDROVO_SEARCH='https://kaluga.cian.ru/kupit-zemelniy-uchastok-kaluzhskaya-oblast-dzerzhinskiy-rayon-kondrovo-01175033/';
const MAX_BYTES=3000000,MAX_OFFERS=25;
const norm=v=>String(v||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const plain=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
function cianURL(value,base='https://www.cian.ru/'){const url=new URL(value,base);if(url.protocol!=='https:'||!(url.hostname==='cian.ru'||url.hostname.endsWith('.cian.ru'))||url.username||url.password||url.port)throw Error('Допускаются только HTTPS-страницы ЦИАН.');url.hash='';return url;}
function offerURL(value,base){const url=cianURL(value,base),match=url.pathname.match(/^\/sale\/suburban\/(\d+)\/?$/);if(!match)return null;url.search='';url.pathname=`/sale/suburban/${match[1]}/`;return {url:url.href,id:match[1]};}
function usageOf(value){const s=norm(value);if(/полев[а-я]*\s+лпх|полев[а-я]*\s+личн/.test(s))return null;if(/(?:^|[^\p{L}\p{N}])ижс(?=$|[^\p{L}\p{N}])|индивидуальн.{0,15}(?:жилищн|жилой)/u.test(s))return 'ИЖС';if(/лпх|личн.{0,12}подсобн/.test(s))return 'ЛПХ';if(/садовод/.test(s))return 'Садоводство';return null;}
function coordinates(value){if(Array.isArray(value)&&value.length>=2)return coordinates({lng:value[0],lat:value[1]});const lat=Number(value?.latitude??value?.lat),lng=Number(value?.longitude??value?.lng);return Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180?{lat,lng}:null;}
function distanceKm(a,b){const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad;const x=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
function areaOf(item){const text=plain(item.name||item.headline);const sqm=text.match(/([\d\s]+(?:[.,]\d+)?)\s*(?:м²|м2|кв\.?\s*м)/i),sot=text.match(/([\d\s]+(?:[.,]\d+)?)\s*сот/i),value=sqm?Number(sqm[1].replace(/\s/g,'').replace(',','.')):sot?Number(sot[1].replace(/\s/g,'').replace(',','.'))*100:null;return value>0?value:null;}
function parseStructured(html){const nodes=[];let count=0;function visit(v,depth=0){if(++count>20000||depth>20)return;if(Array.isArray(v)){for(const x of v)visit(x,depth+1)}else if(v&&typeof v==='object'){if(v.offers)for(const offer of Array.isArray(v.offers)?v.offers:[v.offers])nodes.push({item:v,offer});if(v.itemOffered)nodes.push({item:v.itemOffered,offer:v});for(const [key,x]of Object.entries(v))if(key!=='offers'&&key!=='itemOffered')visit(x,depth+1)}}
 for(const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){try{visit(JSON.parse(m[1]))}catch{}}
 return nodes;
}
export function inspectCianPage(html,url){
 const visible=plain(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''));
 const title=plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]).slice(0,200);
 const challenge=/<js-challenge-loader\b|id=["']id_captcha_frame_div|servicepipe\.tech\/(?:loaders|static\/checkjs)/i.test(html)||/(captcha|проверка (?:браузера|доступа)|подтвердите.{0,30}(?:робот|человек)|доступ ограничен|access denied|verify you are human)/i.test(title+' '+visible);
 const removed=/объявление\s+(?:снято\s+с\s+публикации|удалено|неактивно)|offer\s+(?:removed|unavailable)/i.test(visible);
 const links=[],seen=new Set();if(!challenge&&!removed)for(const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)){try{const offer=offerURL(m[1].replace(/&amp;/g,'&'),url);if(offer&&!seen.has(offer.id)){seen.add(offer.id);links.push(offer)}}catch{}if(links.length>=MAX_OFFERS)break;}
 return {title,challenge,removed,links,structured:challenge||removed?[]:parseStructured(html),bytes:new TextEncoder().encode(html).length};
}
function comparable(node,query,tierKm,pageURL,checkedAt){
 const {item,offer}=node;const name=plain(item.name||item.headline);if(!/^(?:прода[её]тся\s+|продажа\s+)?(?:земельный\s+)?участ(?:ок|ка)(?=$|[^\p{L}])/iu.test(name))return null;
 const active=String(offer.availability||item.availability||'').split('/').at(-1);if(!['InStock','LimitedAvailability'].includes(active))return null;
 const currency=String(offer.priceCurrency||offer.priceSpecification?.priceCurrency||'').toUpperCase(),price=Number(offer.price??offer.priceSpecification?.price);if(!['RUB','RUR'].includes(currency)||!Number.isFinite(price)||price<=0)return null;
 const areaM2=areaOf(item);if(!areaM2||areaM2<query.areaMinM2||areaM2>query.areaMaxM2)return null;
 const usage=usageOf(name+' '+plain(item.description)+' '+JSON.stringify(item.additionalProperty||[]));if(!usage||query.usage&&usage!==query.usage)return null;
 const address=item.address||item.location?.address||offer.availableAtOrFrom?.address;if(!address||typeof address!=='object'||!address.addressLocality)return null;
 const settlement=plain(address.addressLocality),region=plain(address.addressRegion);if(query.region&&norm(region)!==norm(query.region))return null;
 const geo=coordinates(item.geo||item.location?.geo);let distance=null,match;
 if(norm(settlement)===norm(query.settlement))match='settlement';else {if(!tierKm||!query.center||!geo)return null;distance=distanceKm(query.center,geo);if(distance>tierKm)return null;match='radius';}
 let link;try{link=offerURL(offer.url||item.url||item['@id']||pageURL,pageURL)}catch{return null}if(!link)return null;
 const published=item.datePosted||item.datePublished||offer.validFrom||null;if(published&&(!Number.isFinite(Date.parse(published))||Date.parse(published)>Date.parse(checkedAt)))return null;
 return {id:'cian-'+link.id,source:CIAN_SOURCE,sourceOfferId:link.id,url:link.url,price,priceKind:'asking',currency:'RUB',areaM2,area:areaM2/100,usage,settlement,region,address:[region,settlement,plain(address.streetAddress)].filter(Boolean).join(', '),coordinates:geo,locationMatch:match,radiusKm:match==='radius'?tierKm:0,distanceKm:distance,sourceCheckedAt:checkedAt,observedAt:checkedAt,date:checkedAt.slice(0,10),dateKind:'observed',publishedAt:published,provenance:{format:'application/ld+json',pageURL,activeAvailability:active,fields:'explicit_source_values'},title:name};
}
function retryTimestamp(value,now){const n=Number(value),date=Date.parse(value||'');return Math.max(now+30000,n>0?now+n*1000:Number.isFinite(date)?date:now+60000);}
export async function searchCian(input,{fetchImpl=nodeFetch,clock=()=>Date.now(),timeout=10000,maxRequests=28}={}){
 const checkedAt=new Date(clock()).toISOString(),base={source:CIAN_SOURCE,checkedAt,listings:[],connected:false,requests:0,inspectedListings:0,limit:Math.min(MAX_OFFERS,Math.max(1,Number(input?.limit)||MAX_OFFERS)),diagnostics:[],priceKind:'asking'};
 const usage=input?.usage?usageOf(input.usage):null;if(input?.usage&&!usage)return {...base,status:'invalid_request',message:'Неизвестный вид использования участка.'};
 const areaMinM2=Number(input?.areaMinM2??600),areaMaxM2=Number(input?.areaMaxM2??2000),settlement=plain(input?.settlement),region=plain(input?.region);
 if(!settlement||!Number.isFinite(areaMinM2)||!Number.isFinite(areaMaxM2)||areaMinM2<600||areaMaxM2>2000||areaMinM2>areaMaxM2)return {...base,status:'invalid_request',message:'Нужны населённый пункт и площадь в пределах 600–2000 м².'};
 const query={settlement,region,usage,areaMinM2,areaMaxM2,center:coordinates(input?.center)};
 let searchURL=input.searchURL||((norm(settlement)==='кондрово'&&norm(region)==='калужская область')?CIAN_KONDROVO_SEARCH:null);
 if(!searchURL)return {...base,status:'setup_required',message:'Для этого населённого пункта ещё не подтверждён адрес публичного поиска ЦИАН. Автоматическое построение поискового URL не настроено.'};
 const pages=[{radiusKm:0,url:searchURL},...[10,20].flatMap(radiusKm=>{const p=input.radiusPages?.find(p=>p.radiusKm===radiusKm);return p?[p]:[]})];
 try{for(const p of pages)p.url=cianURL(p.url).href;searchURL=pages[0].url}catch(e){return {...base,status:'invalid_request',message:e.message}}
 const result={...base,searchURL,radiusStatus:pages.length<3?'not_configured':'provided',policy:{totalListingLimit:base.limit,areaMinM2,areaMaxM2,radiiKm:[0,10,20],fallback:'only supplied verified public radius URLs'}};const seen=new Set(),queued=new Set();let stop=null;
 const totalSignal=AbortSignal.timeout(Math.max(1000,Math.min(60000,timeout*3)));
 async function page(url){let current=cianURL(url);for(let redirect=0;redirect<3;redirect++){
  if(result.requests>=Math.min(28,Math.max(1,maxRequests)))throw Error('Лимит запросов к ЦИАН исчерпан.');result.requests++;
  const r=await fetchImpl(current,{headers:{accept:'text/html'},credentials:'omit',redirect:'manual',signal:AbortSignal.any([totalSignal,AbortSignal.timeout(timeout)])});
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel();if(!location)throw Error('Перенаправление без адреса.');current=cianURL(location,current);continue;}
  if(!r.ok){await r.body?.cancel();return {status:r.status===429?'limited':r.status===403?'denied':'unavailable',httpStatus:r.status,retryAt:r.status===429?retryTimestamp(r.headers.get('retry-after'),clock()):undefined};}
  const reader=r.body?.getReader();if(!reader)throw Error('Пустой ответ ЦИАН.');const chunks=[];let length=0;try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES){await reader.cancel();throw Error('Страница ЦИАН превышает лимит 3 МБ.');}chunks.push(value)}}finally{reader.releaseLock()}
  const bytes=Buffer.concat(chunks),html=new TextDecoder().decode(bytes),parsed=inspectCianPage(html,current.href);result.diagnostics.push({url:current.href,httpStatus:r.status,title:parsed.title,byteLength:bytes.length,challenge:parsed.challenge,removed:parsed.removed,offerLinks:parsed.links.length,structuredCandidates:parsed.structured.length});
  return {status:parsed.challenge?'access_check':parsed.removed?'removed':'read',httpStatus:r.status,url:current.href,...parsed};
 }throw Error('Слишком много перенаправлений ЦИАН.');}
 function consume(parsed,tierKm){for(const node of parsed.structured){let url;try{url=offerURL(node.offer.url||node.item.url||node.item['@id']||parsed.url,parsed.url)}catch{}if(!url||seen.has(url.id))continue;if(result.inspectedListings>=result.limit)break;seen.add(url.id);result.inspectedListings++;const listing=comparable(node,query,tierKm,parsed.url,checkedAt);if(listing)result.listings.push(listing);}}
 try{for(const tier of pages){if(result.listings.length>=result.limit||result.inspectedListings>=result.limit)break;const p=await page(tier.url);if(p.status!=='read'){stop=p;break}consume(p,tier.radiusKm);
   for(const link of p.links){if(result.listings.length>=result.limit||result.inspectedListings>=result.limit)break;if(seen.has(link.id)||queued.has(link.id))continue;queued.add(link.id);const detail=await page(link.url);if(detail.status==='removed'){seen.add(link.id);result.inspectedListings++;continue}if(detail.status!=='read'){stop=detail;break}consume(detail,tier.radiusKm);if(!seen.has(link.id)){seen.add(link.id);result.inspectedListings++;}}
   if(stop)break;
  }}catch(e){stop={status:e.name==='TimeoutError'?'timeout':'unavailable',message:e.message};}
 if(stop)return {...result,status:result.listings.length?'partial':stop.status,connected:result.listings.length>0,retryAt:stop.retryAt,message:result.listings.length?`Получено ${result.listings.length} проверенных предложений ЦИАН; дальнейший запрос остановлен: ${stop.message||stop.status}.`:`ЦИАН: ${stop.status==='access_check'?'получена страница проверки доступа; объявления не прочитаны':stop.status==='denied'?'источник ограничил доступ':stop.status==='limited'?'источник попросил подождать':stop.message||'данные объявлений пока не получены'}.`,httpStatus:stop.httpStatus};
 if(!result.listings.length)return {...result,status:'schema_unknown',message:'Страница открылась, но актуальные сравнимые объявления с полными полями не подтверждены. Это не означает отсутствие предложений или нулевую цену.'};
 return {...result,status:'available',connected:true,message:`Получено проверенных предложений ЦИАН: ${result.listings.length}. Это цены объявлений, а не сделок.`};
}
