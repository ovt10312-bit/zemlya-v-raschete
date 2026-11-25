import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import {createNodeFetch} from '../server/node-fetch.mjs';
import {cert,key} from './fixtures/local-tls.mjs';

async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
function close(server){server.close();server.closeAllConnections();}
function routes(req,res){
 if(req.url==='/gzip'){res.writeHead(200,{'content-encoding':'gzip','content-type':'application/json'});res.end(gzipSync('{"ok":true}'));return}
 if(req.url==='/redirect'){res.writeHead(302,{location:'/ok'});res.end();return}
 if(req.url==='/slow'){res.writeHead(200,{'content-length':'104857600'});let n=0;const timer=setInterval(()=>{res.write(Buffer.alloc(65536,1));if(++n===1600){clearInterval(timer);res.end()}},2);res.on('close',()=>clearInterval(timer));return}
 if(req.url==='/broken'){res.writeHead(200,{'content-length':'10000000'});res.write(Buffer.alloc(65536));setTimeout(()=>res.destroy(),20);return}
 if(req.url==='/wait'){const timer=setTimeout(()=>res.end('late'),3000);res.on('close',()=>clearTimeout(timer));return}
 res.setHeader('content-type','application/json');res.end('{"ok":true}');
}
test('local transport never calls built-in fetch and supports JSON, gzip and manual/error redirects',async()=>{
 const server=http.createServer(routes),port=await listen(server),fetch=createNodeFetch({proxyEnv:{}}),base='http://127.0.0.1:'+port;
 const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('Builtin fetch must not be used')};
 try{
  assert.deepEqual(await(await fetch(base+'/ok')).json(),{ok:true});assert.deepEqual(await(await fetch(base+'/gzip')).json(),{ok:true});
  const redirect=await fetch(base+'/redirect',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/ok');await redirect.body.cancel();
  await assert.rejects(fetch(base+'/redirect',{redirect:'error'}));
  assert.equal((await fetch(base+'/redirect')).url,base+'/ok');
 }finally{globalThis.fetch=previous;fetch.close();close(server)}
});
test('repeated TLS backpressure, cancellation and truncated responses leave the transport usable',async()=>{
 const server=https.createServer({cert,key},routes),port=await listen(server),fetch=createNodeFetch({proxyEnv:{},ca:cert}),base='https://127.0.0.1:'+port;
 try{
  for(let i=0;i<20;i++){
   const response=await fetch(base+'/slow'),reader=response.body.getReader();assert.ok((await reader.read()).value.length>0);
   await new Promise(resolve=>setTimeout(resolve,3));await reader.cancel();reader.releaseLock();
   const broken=await fetch(base+'/broken');await assert.rejects(broken.arrayBuffer());
  }
  assert.deepEqual(await(await fetch(base+'/ok')).json(),{ok:true});
 }finally{fetch.close();close(server)}
});
test('TLS certificates are verified and timeout/abort stays a request error',async()=>{
 const server=https.createServer({cert,key},routes),port=await listen(server),base='https://127.0.0.1:'+port;
 const untrusted=createNodeFetch({proxyEnv:{}}),trusted=createNodeFetch({proxyEnv:{},ca:cert});
 try{
  await assert.rejects(untrusted(base+'/ok'),/self-signed certificate/);
  await assert.rejects(trusted(base+'/wait',{signal:AbortSignal.timeout(30)}),e=>e.name==='TimeoutError');
  const ctrl=new AbortController();const response=await trusted(base+'/slow',{signal:ctrl.signal});ctrl.abort();await assert.rejects(response.arrayBuffer());
  assert.deepEqual(await(await trusted(base+'/ok')).json(),{ok:true});
 }finally{untrusted.close();trusted.close();close(server)}
});
test('configured environment proxy is honored without using Undici',async()=>{
 let requests=0;const proxy=http.createServer((req,res)=>{requests++;assert.equal(req.url,'http://example.invalid/test');res.end('proxy response')});
 const port=await listen(proxy),fetch=createNodeFetch({proxyEnv:{http_proxy:'http://127.0.0.1:'+port,no_proxy:''}});
 try{assert.equal(await(await fetch('http://example.invalid/test')).text(),'proxy response');assert.equal(requests,1)}finally{fetch.close();close(proxy)}
});
