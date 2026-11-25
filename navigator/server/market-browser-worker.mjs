import {createBrowserMarkets} from './market-browser.mjs';
const market=createBrowserMarkets({root:process.argv[2]});
process.on('disconnect',()=>process.exit(0));
process.on('message',message=>{
 const {id,source,input}=message||{};
 if(!Number.isInteger(id)||!['Авито','ЦИАН'].includes(source))return;
 Promise.resolve().then(()=>source==='Авито'?market.avito(input):market.cian(input)).catch(()=>({source,status:'automation_failed',connected:false,listings:[],message:'Ошибка процесса поиска.'})).then(result=>{
  if(process.connected)process.send({id,result},()=>{});
 }).catch(()=>{});
});
