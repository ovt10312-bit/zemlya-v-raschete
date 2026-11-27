import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {openBrowserSetup} from '../server/browser-setup.mjs';
function harness(){const calls=[];const spawnImpl=(exe,args,options)=>{const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};child.stdin=new EventEmitter();child.stdin.end=data=>{calls.at(-1).stdin=data;queueMicrotask(()=>child.emit('exit',0))};calls.push({exe,args,options});queueMicrotask(()=>child.emit('spawn'));return child};return {calls,spawnImpl}}
const folder='C:\\Навигатор\\browser-extension',comet='C:\\Users\\Owner\\AppData\\Local\\Perplexity\\Comet\\Application\\comet.exe';
const common={platform:'win32',baseDir:'C:\\Навигатор',env:{LOCALAPPDATA:'C:\\Users\\Owner\\AppData\\Local',SystemRoot:'C:\\Windows'},exists:file=>file===comet||file===folder+'\\manifest.json'};
test('one click copies literal folder path and opens only Comet extensions and that folder',async()=>{
 const h=harness();const result=await openBrowserSetup({...common,...h});assert.equal(result.clipboardCopied,true);assert.equal(result.extensionFolder,folder);assert.equal(h.calls.length,3);assert.equal(h.calls[0].stdin,folder);assert.ok(!h.calls[0].args.at(-1).includes(folder));assert.match(h.calls[0].args.at(-1),/InputEncoding/);assert.equal(h.calls[1].exe,comet);assert.deepEqual(h.calls[1].args,['--new-window','chrome://extensions/']);assert.equal(h.calls[2].exe,'C:\\Windows\\explorer.exe');assert.deepEqual(h.calls[2].args,[folder]);
});
test('missing browser and unsupported platform do not start processes or touch clipboard',async()=>{
 const h=harness();await assert.rejects(openBrowserSetup({...common,...h,exists:file=>file.endsWith('manifest.json'),registry:async()=>[]}),/Не найден установленный Comet/);await assert.rejects(openBrowserSetup({...common,...h,platform:'linux'}),/Windows/);assert.equal(h.calls.length,0);
});
test('registry fallback accepts only an existing comet.exe without command arguments',async()=>{
 const h=harness(),registered='D:\\Apps\\Comet\\comet.exe';const result=await openBrowserSetup({...common,...h,exists:file=>file.endsWith('manifest.json')||file===registered,registry:async()=>['C:\\bad.exe --run',registered]});assert.equal(result.clipboardCopied,true);assert.equal(h.calls[1].exe,registered);
});
