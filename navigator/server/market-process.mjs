import {fork} from 'node:child_process';

// Browser/Playwright failures must not terminate the local HTTP server.
export function createMarketProcess({root,timeoutMs=100000,workerURL=new URL('./market-browser-worker.mjs',import.meta.url)}={}){
 let child=null,nextId=0;const pending=new Map();
 function fail(process,stage,message){
  if(child===process)child=null;
  for(const [id,job] of pending){if(job.process!==process)continue;clearTimeout(job.timer);pending.delete(id);job.resolve({source:job.source,status:stage==='browser_timeout'?'timeout':'automation_failed',stage,message,connected:false,listings:[],requests:0,checkedAt:new Date().toISOString(),transport:'visible_browser'});}
 }
 function terminate(process){
  if(!process)return;process.kill();const timer=setTimeout(()=>{if(process.exitCode===null&&process.signalCode===null)process.kill('SIGKILL')},2000);timer.unref();
 }
 function launch(){
  if(child)return child;
  const process=fork(workerURL,[root],{execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});child=process;
  process.on('message',message=>{const job=pending.get(message?.id);if(!job||job.process!==process)return;clearTimeout(job.timer);pending.delete(message.id);job.resolve(message.result);});
  process.on('error',()=>{fail(process,'browser_process','Не удалось запустить отдельный процесс поиска. Навигатор продолжает работать.');terminate(process)});
  process.on('exit',(code,signal)=>fail(process,'browser_process',`Процесс поиска завершился (${signal||code||0}). Навигатор продолжает работать; поиск можно повторить.`));
  process.unref();process.channel?.unref();return process;
 }
 function run(source,input){return new Promise(resolve=>{
  let process;try{process=launch()}catch{resolve({source,status:'automation_failed',stage:'browser_process',connected:false,listings:[],message:'Не удалось запустить процесс поиска.'});return}
  const id=++nextId;const timer=setTimeout(()=>{fail(process,'browser_timeout','Сайт или браузер не ответил вовремя. Поиск остановлен; Навигатор продолжает работать.');terminate(process)},timeoutMs);
  pending.set(id,{process,source,resolve,timer});
  const disconnected=()=>{fail(process,'browser_process','Связь с процессом поиска прервалась. Навигатор продолжает работать.');terminate(process)};
  try{process.send({id,source,input},error=>{if(error)disconnected()})}catch{disconnected()}
 });}
 return {avito:input=>run('Авито',input),cian:input=>run('ЦИАН',input),close(){const process=child;if(process){fail(process,'browser_stopped','Поиск остановлен.');terminate(process)}}};
}
