const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
async function clickChoice(page,name){
 for(const role of ['link','button','combobox','option','menuitem','menuitemradio','radio','treeitem']){
  const names=typeof name==='string'?[name,new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s*(?:\\([\\d\\s]+\\)|\\d[\\d\\s]*))?$','i')]:[name];
  for(const label of names){const options=page.getByRole(role,{name:label,exact:typeof label==='string'});
   for(let i=0;i<Math.min(await options.count(),20);i++){const item=options.nth(i);if(role==='combobox'&&typeof item.evaluate==='function'&&await item.evaluate(element=>element.tagName==='SELECT'))continue;if(await item.isVisible()&&!(typeof item.isEnabled==='function'&&!await item.isEnabled())){await item.click({timeout:5000});return true}}
  }
 }
 return false;
}
async function selectNativeCategory(page,label){
 const selects=page.locator('select');
 for(let i=0;i<Math.min(await selects.count(),10);i++){
  const select=selects.nth(i);if(!await select.isVisible()||typeof select.selectOption!=='function'||typeof select.isEnabled==='function'&&!await select.isEnabled())continue;
  const options=await select.evaluate(element=>[...element.options].map(option=>({label:option.label,value:option.value,disabled:option.disabled})));
  const matching=options.filter(option=>!option.disabled&&normalize(option.label)===label);
  if(matching.length===1){await select.selectOption(matching[0].value,{timeout:5000});return true}
 }
 return false;
}
function landPage(page){try{const url=new URL(page.url());return url.protocol==='https:'&&['avito.ru','www.avito.ru'].includes(url.hostname)&&/\/(?:[^/]+\/)?zemelnye_uchastki(?:\/|$)/.test(url.pathname)}catch{return false}}
// Read the actual public form/menu options. No category IDs, city slugs,
// unpublished endpoints, force clicks or blind clicks on screen coordinates.
export async function chooseAvitoLandCategory(page,{waitMs=8000,clock=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checkAccess=async()=>{}}={}){
 const deadline=clock()+Math.max(0,Math.min(12000,waitMs));let parentChosen=false,menuOpened=false;
 do{
  await checkAccess();
  if(landPage(page))return {method:'published_land_page'};
  if(!parentChosen){
   if(await selectNativeCategory(page,'Недвижимость')){parentChosen=true;continue}
   if(await clickChoice(page,'Недвижимость')){parentChosen=true;continue}
  }
  if(await selectNativeCategory(page,'Земельные участки'))return {method:'native_category_option'};
  if(await clickChoice(page,'Земельные участки'))return {method:'public_category_item'};
  if(!menuOpened&&await clickChoice(page,/^(?:Все категории|Каталог|Категории|Категория|Выбрать категорию)$/i)){menuOpened=true;continue}
  if(clock()>=deadline)break;
  await pause(Math.min(300,deadline-clock()));
 }while(clock()<=deadline);
 throw Object.assign(Error('Не удалось выбрать «Недвижимость → Земельные участки» в форме Авито.'),{stage:'category_control'});
}
export async function avitoFormDiagnostics(page){
 if(typeof page.evaluate!=='function')return null;
 try{return await page.evaluate(()=>{
  const relevant=/недвижим|земельн|категори|город|регион|местоположен|найти|показать/i;
  const visible=element=>{const box=element.getBoundingClientRect();return box.width>0&&box.height>0&&getComputedStyle(element).visibility!=='hidden'};
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,100);
  const controls=[...document.querySelectorAll('a,button,[role="button"],[role="combobox"],[role="option"],[role="menuitem"]')].filter(element=>visible(element)&&relevant.test(element.getAttribute('aria-label')||element.innerText||'')).slice(0,30).map(element=>({tag:element.tagName.toLowerCase(),role:element.getAttribute('role'),label:clean(element.getAttribute('aria-label')||element.innerText)}));
  const selects=[...document.querySelectorAll('select')].filter(element=>visible(element)&&[...element.options].some(option=>/недвижим|земельн|категори/i.test(option.label))).slice(0,5).map(element=>({name:clean(element.name),options:[...element.options].slice(0,40).map(option=>({label:clean(option.label),disabled:option.disabled}))}));
  const inputs=[...document.querySelectorAll('input')].filter(element=>visible(element)&&/город|регион|местоположен|поиск/i.test(element.placeholder||element.getAttribute('aria-label')||'')).slice(0,10).map(element=>({type:element.type,placeholder:clean(element.placeholder),label:clean(element.getAttribute('aria-label'))}));
  return {title:clean(document.title),path:location.pathname,controls,selects,inputs};
 })}catch{return null}
}
