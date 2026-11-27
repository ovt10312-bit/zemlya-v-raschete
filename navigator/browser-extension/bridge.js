// Only this local page can ask its installed extension to collect public cards.
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='zemlya-market-request')return;
 const {id,type,input}=event.data;if(typeof id!=='string'||id.length>80)return;
 if(type==='ping'){window.postMessage({channel:'zemlya-market-response',id,result:{installed:true}},location.origin);return;}
 if(type!=='collect')return;
 chrome.runtime.sendMessage({type:'collect',input}).then(result=>window.postMessage({channel:'zemlya-market-response',id,result},location.origin)).catch(()=>window.postMessage({channel:'zemlya-market-response',id,result:{status:'automation_failed',message:'Связь с расширением прервалась. Обнови страницу Навигатора.'}},location.origin));
});
