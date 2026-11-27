import test from 'node:test';import assert from 'node:assert/strict';
import {requestBrowserExtension} from '../src/market-extension.mjs';
test('extension client accepts only the matching message from its own window and origin',async()=>{
 let listener,request;const target={location:{origin:'http://127.0.0.1:8787'},addEventListener(type,fn){listener=fn},removeEventListener(){listener=null},postMessage(message,origin){request={message,origin}}};
 const pending=requestBrowserExtension('ping',undefined,{target,timeoutMs:1000});assert.equal(request.origin,target.location.origin);
 const data={channel:'zemlya-market-response',id:request.message.id,result:{installed:true}};
 listener({source:{},origin:target.location.origin,data});assert.ok(listener);
 listener({source:target,origin:'https://evil.example',data});assert.ok(listener);
 listener({source:target,origin:target.location.origin,data:{...data,id:'wrong'}});assert.ok(listener);
 listener({source:target,origin:target.location.origin,data});assert.deepEqual(await pending,{installed:true});assert.equal(listener,null);
});
test('missing extension fails at a bounded timeout and removes its listener',async()=>{
 let removed=false;const target={location:{origin:'http://127.0.0.1:8787'},addEventListener(){},removeEventListener(){removed=true},postMessage(){}};
 await assert.rejects(requestBrowserExtension('ping',undefined,{target,timeoutMs:5}),/установи расширение/);assert.equal(removed,true);
});
