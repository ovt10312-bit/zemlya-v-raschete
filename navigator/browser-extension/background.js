import {avitoPageStep} from './avito-page.js';
let active=false;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function allowed(sender){try{const u=new URL(sender.url);return ['http://127.0.0.1:8787','http://localhost:8787'].includes(u.origin)}catch{return false}}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(!allowed(sender)||message?.type!=='collect')return false;
 if(active){respond({status:'busy',message:'Поиск в браузере уже выполняется.'});return false;}
 const input=message.input;
 if(!input||typeof input.settlement!=='string'||!input.settlement.trim()||input.settlement.length>200||typeof input.region!=='string'||!input.region.trim()||input.region.length>200||!['ИЖС','ЛПХ','Садоводство'].includes(input.usage)){
  respond({status:'invalid_request',message:'Не определены населённый пункт, регион или назначение.'});return false;
 }
 active=true;collect(input).then(async result=>{if(result.status==='completed'&&sender.tab?.id)await chrome.tabs.update(sender.tab.id,{active:true}).catch(()=>{});respond(result)},e=>respond({status:'automation_failed',message:e.message||'Не удалось прочитать выдачу Авито.'})).finally(()=>{active=false});return true;
});
async function collect(input){
 const tab=await chrome.tabs.create({url:'https://www.avito.ru/',active:true});
 let state={phase:'category'},lastPhase=state.phase,phaseSince=Date.now(),accessSince=0,searchURL='',idlePasses=0;const cards=new Map(),deadline=Date.now()+60000;
 while(Date.now()<deadline){
  const current=await chrome.tabs.get(tab.id).catch(()=>null);if(!current)throw Error('Вкладка поиска закрыта. Можно запустить поиск снова.');
  if(current.status!=='complete'){await pause(300);continue;}
  // Injection itself is restricted by manifest host permissions. A redirect to
  // any other website is never read or followed by injected automation.
  let step;try{step=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:avitoPageStep,args:[input,state]}))[0]?.result}catch{throw Error('Страница Авито изменилась или недоступна. Вкладка оставлена открытой.');}
  if(!step)throw Error('Страница не вернула результат.');
  if(step.error)return {status:step.status||'automation_failed',message:step.error,cards:[]};
  if(step.waitAccess){accessSince ||= Date.now();if(Date.now()-accessSince>10000)return {status:'access_check',message:'Авито продолжает проверку доступа. Поиск остановлен; вкладка оставлена открытой.',cards:[]};await pause(400);continue;}
  accessSince=0;state=step.state||state;
  if(state.phase!==lastPhase){lastPhase=state.phase;phaseSince=Date.now();}
  if(state.phase!=='collect'&&Date.now()-phaseSince>10000)throw Error('Не удалось завершить выбор категории или населённого пункта. Вкладка Авито оставлена открытой.');
  if(step.cards){const before=cards.size;searchURL=step.searchURL||searchURL;for(const card of step.cards){if(cards.size>=25)break;if(card.url&&!cards.has(card.url))cards.set(card.url,card);}idlePasses=cards.size===before?idlePasses+1:0;if(cards.size>=25||idlePasses>=3)return {status:cards.size?'completed':'schema_unknown',message:cards.size?'Список объявлений прочитан в браузере.':'Не удалось прочитать карточки объявлений. Это не означает, что объявлений нет.',cards:[...cards.values()],searchURL,locationSelected:state.locationSelected};}
  await pause(400);
 }
 return {status:'timeout',message:'Авито не завершил поиск за минуту. Вкладка оставлена открытой.',cards:[]};
}
