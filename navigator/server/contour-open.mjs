import {saveFormationParcel} from './service.mjs';
export function createContourOpener({nspd,env,user,readParcel=()=>null,schedule=fn=>setTimeout(fn,0)}){
 const pending=new Map();
 function quarterFor(proposal){const q=nspd.quarters.peek(proposal.geometry)||{quarterCadastre:null,quarterOrigin:'unknown'};const old=readParcel(proposal.id);return !q.quarterCadastre&&old?.quarterOrigin==='manual'?{...q,quarterCadastre:old.quarterCadastre,quarterOrigin:'manual'}:q;}
 async function save(job,proposal,searchId,quarter,background){if(background){const latest=nspd.formation.result(job.id).job,current=latest?.proposals?.find(p=>p.id===proposal.id);if(current){job=latest;proposal=current}}const ref=quarter.quarterCadastre?nspd.cadastralReference(searchId,quarter.quarterCadastre,background):null;return saveFormationParcel(env,user,{...job,quarterAssignment:{...quarter,quarterAssignmentPending:pending.has(proposal.id)},cadastralReference:ref},proposal)}
 async function open(input){const search=nspd.simple.result(String(input.searchId||'')),job=search.job?.formationId?nspd.formation.result(search.job.formationId).job:null,proposal=job?.proposals.find(p=>p.id===String(input.proposalId||''));if(!proposal)throw Error('Сохранённый контур не найден');
  const cached=quarterFor(proposal);if(!pending.has(proposal.id)&&(!cached.quarterCadastre||nspd.cadastralReference(search.job.id,cached.quarterCadastre,false)?.status==='loading')){
   pending.set(proposal.id,true);schedule(()=>{(async()=>{try{let q=await nspd.quarters.resolve(proposal.geometry);if(!q.quarterCadastre)q=quarterFor(proposal);pending.delete(proposal.id);for(let attempt=0;attempt<3;attempt++){try{await save(job,proposal,search.job.id,q,true);break}catch(e){if(attempt===2)throw e}}}catch(e){pending.delete(proposal.id);console.warn('Обновление сведений контура: '+e.message);try{await save(job,proposal,search.job.id,quarterFor(proposal),false)}catch{console.warn('Не удалось сохранить статус проверки контура.')}}finally{pending.delete(proposal.id)}})().catch(()=>{})});
  }
  // No external calls or worker startup on this request path.
  return save(job,proposal,search.job.id,cached,false);
 }
 return {open};
}
