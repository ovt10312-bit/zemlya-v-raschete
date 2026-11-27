export function requestBrowserExtension(type,input,{target=window,timeoutMs=type==='ping'?1000:70000}={}){
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();const cleanup=()=>{clearTimeout(timer);target.removeEventListener('message',listener)};
  const listener=event=>{if(event.source!==target||event.origin!==target.location.origin||event.data?.channel!=='zemlya-market-response'||event.data.id!==id)return;cleanup();resolve(event.data.result)};
  const timer=setTimeout(()=>{cleanup();reject(Error(type==='ping'?'Для автоматического поиска установи расширение и открой Навигатор в этом же браузере.':'Расширение не завершило поиск вовремя. Проверь открытую вкладку Авито.'))},timeoutMs);
  target.addEventListener('message',listener);target.postMessage({channel:'zemlya-market-request',id,type,input},target.location.origin);
 });
}
