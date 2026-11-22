import {parentPort,workerData} from 'node:worker_threads';
import {cadastralReference} from '../src/cadastral-reference.mjs';
try{parentPort.postMessage({value:cadastralReference(workerData.objects,workerData.options)})}catch(e){parentPort.postMessage({error:e.message})}
