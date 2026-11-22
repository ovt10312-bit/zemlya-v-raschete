import {mkdir,stat,readFile,writeFile,rename,open,statfs} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const MAX=2*1024**3;
export function archiveURL(value){const u=new URL(value);if(u.protocol!=='https:'||!['rosreestr.gov.ru','www.rosreestr.gov.ru'].includes(u.hostname)||u.port||u.username||u.password||!u.pathname.startsWith('/data-sets/')||!u.pathname.toLowerCase().endsWith('.csv.zip'))throw Error('Нужен официальный ZIP сделок Росреестра.');u.hash='';return u;}
export async function downloadArchive(file,{root,signal,fetchImpl=fetch,onProgress=()=>{},idleMs=30000}={}){
 const url=archiveURL(file.url),key=createHash('sha256').update(url.href).digest('hex'),folder=path.join(root,'rosreestr-archives');await mkdir(folder,{recursive:true});const final=path.join(folder,key+'.zip'),part=final+'.part',metaPath=part+'.json';
 try{const s=await stat(final);onProgress(s.size,s.size,true);return {path:final,cached:true,bytes:s.size,downloadedAt:s.mtime.toISOString()};}catch(e){if(e.code!=='ENOENT')throw e;}
 let saved=null,offset=0;try{saved=JSON.parse(await readFile(metaPath,'utf8'));offset=(await stat(part)).size;if(saved.url!==url.href||!saved.validator||offset>MAX)offset=0;}catch{offset=0;}
 const ctrl=new AbortController(),abort=()=>ctrl.abort(signal.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});let timer;const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>ctrl.abort(Error('Источник не передаёт данные более 30 секунд.')),idleMs);timer.unref?.()};arm();let response,out,reader;
 try{let target=url;for(let i=0;i<4;i++){
  response=await fetchImpl(target,{headers:{accept:'application/zip,application/octet-stream', 'accept-encoding':'identity',...(offset?{range:`bytes=${offset}-`,'if-range':saved.validator}:{})},credentials:'omit',redirect:'manual',signal:ctrl.signal});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('Перенаправление без адреса.');target=archiveURL(new URL(next,target).href);response=null;continue;}break;
 }
 if(!response)throw Error('Слишком много перенаправлений.');if(!response.ok){await response.body?.cancel();const error=Error(`Росреестр вернул HTTP ${response.status}.`);error.httpStatus=response.status;error.retryAfter=response.headers.get('retry-after');throw error;}
 const range=response.headers.get('content-range'),match=range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/),validator=response.headers.get('etag')&&!response.headers.get('etag').startsWith('W/')?response.headers.get('etag'):response.headers.get('last-modified');
 if(response.status===206){if(!match||Number(match[1])!==offset||Number(match[2])+1!==Number(match[3]))throw Error('Неверный диапазон полного архива.');if(offset&&validator&&validator!==saved.validator){await writeFile(metaPath,'{}');throw Error('Архив изменился при продолжении загрузки. Повторный запуск начнёт его заново.');}}else if(response.status===200)offset=0;else throw Error('Неожиданный ответ загрузки архива.');
 const declared=Number(response.headers.get('content-length')),total=match?Number(match[3]):declared>0?declared:null;if(total!==null&&(!Number.isSafeInteger(total)||total>MAX||total<offset))throw Error('Размер архива превышает лимит 2 ГиБ.');
 const disk=await statfs(folder);if(total&&Number(disk.bavail)*Number(disk.bsize)<total-offset+16*1024**2)throw Error('Недостаточно места для архива.');
 const ensureOpen=async()=>{if(!out){await writeFile(metaPath,JSON.stringify({url:url.href,validator,total}));out=await open(part,offset?'a':'w')}};reader=response.body?.getReader();if(!reader)throw Error('Источник вернул пустой ответ.');let bytes=offset,head=Buffer.alloc(0),verified=offset>0;
 while(true){ctrl.signal.throwIfAborted();arm();const {done,value}=await reader.read();if(done)break;const chunk=Buffer.from(value);bytes+=chunk.length;if(bytes>MAX||total!==null&&bytes>total)throw Error('Источник превысил объявленный размер.');
  if(!verified){head=Buffer.concat([head,chunk]);if(head.length<4)continue;if(head.readUInt32LE(0)!==0x04034b50)throw Error('Вместо ZIP получена другая страница.');verified=true;await ensureOpen();await out.writeFile(head);head=Buffer.alloc(0);}else{await ensureOpen();await out.writeFile(chunk);}
  onProgress(bytes,total,false);
 }
 if(!verified||total!==null&&bytes!==total)throw Error('Архив загружен не полностью.');await out.close();out=null;await rename(part,final);return {path:final,cached:false,bytes,downloadedAt:new Date().toISOString()};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(!reader)await response?.body?.cancel().catch(()=>{});await reader?.cancel().catch(()=>{});reader?.releaseLock();await out?.close().catch(()=>{});}
}
