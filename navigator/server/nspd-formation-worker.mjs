import {parentPort,workerData} from 'node:worker_threads';
import {prepareFormation,findFormationInCell} from '../src/nspd-formation-domain.mjs';
try{
 const {scan,objects,options,startIndex=0,found=0}=workerData;
 const plan=prepareFormation(scan,objects);const coords=scan.territory.geometry.coordinates.flat(Infinity);
 // Prioritise fragments near the middle of the saved settlement, without claiming road access.
 const cx=(Math.min(...coords.filter((_,i)=>i%2===0))+Math.max(...coords.filter((_,i)=>i%2===0)))/2;
 const cy=(Math.min(...coords.filter((_,i)=>i%2===1))+Math.max(...coords.filter((_,i)=>i%2===1)))/2;
 const cells=plan.cells.toSorted((a,b)=>{const d=c=>((c.scope.west+c.scope.east)/2-cx)**2*Math.cos(cy*Math.PI/180)**2+((c.scope.south+c.scope.north)/2-cy)**2;return d(a)-d(b)||a.id.localeCompare(b.id)});
 let count=found;
 parentPort.postMessage({type:'ready',total:cells.length});
 if(startIndex>=cells.length||count>=30)parentPort.postMessage({type:'done',limited:startIndex<cells.length});
 for(let i=startIndex;i<cells.length&&count<30;i++){
  const proposal=findFormationInCell(cells[i],plan.obstacles,options);
  if(proposal)count++;
  parentPort.postMessage({type:'cell',nextIndex:i+1,total:cells.length,proposal});
  if(count>=30){parentPort.postMessage({type:'done',limited:i+1<cells.length});break;}
  if(i+1===cells.length)parentPort.postMessage({type:'done',limited:false});
 }
}catch(e){parentPort.postMessage({type:'failure',message:e.message});}
