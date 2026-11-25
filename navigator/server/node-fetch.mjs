import fetchHTTP from 'node-fetch';
import http from 'node:http';
import https from 'node:https';
import {Readable} from 'node:stream';

// Node 24.22.x's built-in fetch can abort the whole process in Undici's
// Parser.finish assertion after a paused response socket ends. Use the
// independent node:http(s) transport for local downloads, including workers.
// Keep TLS verification and configured environment proxies. Do not reuse
// partially consumed sockets after a cancelled/limited response.
export function createNodeFetch({proxyEnv=process.env,ca}={}){
 const httpAgent=new http.Agent({keepAlive:false,proxyEnv});
 const httpsAgent=new https.Agent({keepAlive:false,proxyEnv,...(ca?{ca}:{})});
 async function request(input,options={}){
  const signal=options.signal;
  try{
   signal?.throwIfAborted();
   const response=await fetchHTTP(input,{...options,agent:url=>url.protocol==='https:'?httpsAgent:httpAgent});
   const body=response.body&&String(options.method||'GET').toUpperCase()!=='HEAD'&&![204,205,304].includes(response.status)?Readable.toWeb(response.body,{strategy:{highWaterMark:65536,size:chunk=>chunk.byteLength}}):null;
   const result=new Response(body,{status:response.status,statusText:response.statusText,headers:[...response.headers]});
   Object.defineProperty(result,'url',{value:response.url});
   return result;
  }catch(error){if(signal?.aborted)throw signal.reason;throw error}
 }
 request.close=()=>{httpAgent.destroy();httpsAgent.destroy()};
 return request;
}
export const nodeFetch=createNodeFetch();
