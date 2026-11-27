// Executed in the public page's isolated extension world. No cookies, account
// information, private endpoints or CAPTCHA interaction are read or used.
export function avitoPageStep(input,state){
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
 const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'};
 const all=selector=>[...document.querySelectorAll(selector)].filter(visible);
 const label=el=>norm(el.getAttribute('aria-label')||el.innerText||el.textContent);
 const click=re=>{const el=all('a,button,[role="button"],[role="option"],[role="menuitem"],[role="combobox"],[role="radio"],[role="treeitem"]').find(el=>!el.disabled&&re.test(label(el)));if(!el)return false;el.click();return true;};
 const words=(text,value)=>{const a=norm(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean),b=norm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);return b.length>0&&a.some((_,i)=>b.every((v,j)=>a[i+j]===v));};
 const title=norm(document.title),body=norm(document.body?.innerText||'').slice(0,100000);
 if(/(?:доступ ограничен|доступ запрещен|access denied).{0,100}\bip\b|проблема с ip/.test(title+' '+body))return {error:'Авито ограничил доступ: проблема с IP. Поиск остановлен.',status:'denied'};
 if(/доступ ограничен|доступ запрещен|access denied|проверка браузера|подтвердите.{0,40}(?:человек|не робот)/.test(title+' '+body))return {waitAccess:true,state};
 // Ordinary dismiss controls inside a visible location permission notice only.
 for(const dialog of all('[role="dialog"]'))if(/разрешите.{0,40}(?:местоположени|геолокаци)/i.test(dialog.innerText)){
  const close=[...dialog.querySelectorAll('button,[role="button"]')].filter(visible).find(el=>/^(?:не сейчас|отмена|закрыть|запретить|нет|позже)$/.test(label(el)));close?.click();
 }
 const land=location.pathname.includes('/zemelnye_uchastki');
 if(state.phase==='category'){
  if(land)return {state:{...state,phase:'location'}};
  const native=all('select');for(const text of ['Недвижимость','Земельные участки'])for(const select of native){const option=[...select.options].find(o=>norm(o.label)===norm(text)&&!o.disabled);if(option&&select.value!==option.value){select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));return {state};}}
  if(click(/^земельные участки(?:\s*\([\d\s]+\)|\s*\d[\d\s]*)?$/))return {state};
  if(!state.parentChosen&&click(/^недвижимость(?:\s*\([\d\s]+\))?$/))return {state:{...state,parentChosen:true}};
  if(!state.menuOpened&&click(/^(?:все категории|каталог|категории|категория|выбрать категорию)$/))return {state:{...state,menuOpened:true}};
  return {state};
 }
 if(state.phase==='location'){
  const field=all('input[placeholder*="город" i],input[placeholder*="регион" i],input[data-marker*="location"][type="text"]')[0];
  if(field){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,input.settlement);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));return {state:{...state,phase:'suggestions'}};}
  const picker=all('[data-marker="search-form/region"],[data-marker="search-form/location"],[data-marker="search-form/location-picker"]')[0];
  if(picker)picker.click();else click(/^(?:все регионы|город или регион|местоположение|выбрать город|изменить город|выбрать регион)(?:\s|$)/);
  return {state};
 }
 if(state.phase==='suggestions'){
  const options=all('[role="option"],[data-marker*="suggest"] button,[data-marker*="suggest"] li,[data-marker="popup-location/region/search/suggest"],[data-marker="popup-location/region/search-suggest"]');
  const matches=options.filter(el=>words(label(el),input.settlement)&&words(label(el),input.region)).filter((el,_,items)=>!items.some(other=>other!==el&&el.contains(other)));
  if(matches.length>1)return {error:'Неоднозначный населённый пункт. Поиск в другом месте не выполнялся.'};
  if(matches.length===1){matches[0].click();return {state:{...state,phase:'apply',locationSelected:true}};}
  return {state};
 }
 if(state.phase==='apply'){
  click(/^(?:показать|применить|выбрать)(?:\s|$)/);return {state:{...state,phase:'search'}};
 }
 if(state.phase==='search'){
  click(/^(?:найти|показать)(?:\s|$)/);return {state:{...state,phase:'collect'}};
 }
 if(!land||!state.locationSelected)return {state};
 const cards=all('[data-marker="item"]').slice(0,100).map(el=>{
  const title=el.querySelector('[data-marker="item-title"]'),price=el.querySelector('[data-marker="item-price"]'),address=el.querySelector('[data-marker="item-address"],[data-marker="item-location"]');
  const priceText=price?.innerText||'';
  return {title:title?.innerText||'',url:title?.href||title?.closest('a')?.href||'',price:price?.querySelector('[itemprop="price"]')?.getAttribute('content')||priceText.replace(/\s*(?:₽|руб\.?)\s*$/i,''),currency:price?.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content')||(/₽|руб/i.test(priceText)?'RUB':''),location:address?.innerText||'',usageText:el.innerText.slice(0,4000)};
 });
 window.scrollBy(0,Math.max(500,window.innerHeight-100));
 return {state,cards,searchURL:location.href};
}
