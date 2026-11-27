export async function requestMarket({parcelId,body,fetchImpl=globalThis.fetch,signal}){
 const timeout=AbortSignal.timeout(8000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 let response;
 try{response=await fetchImpl('/api/market'+(body?'':'?parcelId='+encodeURIComponent(parcelId)),{method:body?'POST':'GET',signal:combined,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify({...body,parcelId})}:{})})}
 catch(e){if(signal?.aborted)throw e;throw Error(timeout.aborted?'Навигатор не ответил вовремя. Проверим состояние поиска; повторный запуск не выполняется.':'Потеряна связь с локальным сервером Навигатора. Открой программу ярлыком, затем проверь состояние поиска.');}
 let data;try{data=await response.json()}catch{throw Error('Сервер вернул неполный ответ. Проверь состояние поиска.');}
 signal?.throwIfAborted();if(!response.ok)throw Error(data?.error||'Не удалось получить ответ Навигатора.');return data;
}
