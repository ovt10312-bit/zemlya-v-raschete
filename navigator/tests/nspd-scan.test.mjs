import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createNspdScanner} from '../server/nspd-scan.mjs';
import {planCells,splitCell,screenObject,objectKey,geometryArea} from '../src/nspd-scan-domain.mjs';
import {boxGeometry,geometryWithin,geometryOverlaps} from '../src/nspd-geometry.mjs';
const boundary=boxGeometry({west:35.9,east:35.912,south:54.8,north:54.803});
const parcel=()=>({id:'42',hasStableSourceId:true,name:'40:04:000001:42',areaM2:800,coordinateStatus:'declared',geometry:boxGeometry({west:35.901,east:35.902,south:54.801,north:54.802}),attributes:{cad_num:'40:04:000001:42',ownership_type:'Муниципальная',permitted_use_established_by_document:'Для индивидуального жилищного строительства'}});
const territory=()=>({id:'town',name:'Контрольный населённый пункт',boundaryVersion:'v1',usable:true,geometry:boundary});
const response=(objects=[])=>({status:'available',checkedAt:'2026-11-21T12:00:00Z',httpStatus:200,count:objects.length,objects});
async function waitFor(fn){for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Wait timeout');}
function fixture(query){const db=new DatabaseSync(':memory:');let t=100000;const args={db,getTerritory:territory,query,gapMs:0,clock:()=>t};return {db,args,scanner:createNspdScanner(args),tick(){t+=100000;}};}

test('grid covers all components, preserves holes and subdivides without adding territory',()=>{
 const outer=boxGeometry({west:35.9,east:35.912,south:54.8,north:54.81}),hole=boxGeometry({west:35.904,east:35.908,south:54.803,north:54.807}),island=boxGeometry({west:35.92,east:35.921,south:54.8,north:54.801});
 const g={type:'MultiPolygon',coordinates:[[outer.coordinates[0],hole.coordinates[0]],island.coordinates]};
 const cells=planCells(g);assert.ok(cells.length>1);assert.ok(cells.every(c=>geometryWithin(c.geometry,[g])===true));assert.ok(cells.every(c=>geometryOverlaps(c.geometry,hole)===false));
 assert.ok(Math.abs(cells.reduce((n,c)=>n+c.area,0)-geometryArea(g))<1e-12);
 const children=splitCell(g,cells[0]);assert.ok(children.every(c=>geometryWithin(c.geometry,[cells[0].geometry])===true));assert.ok(Math.abs(children.reduce((n,c)=>n+c.area,0)-cells[0].area)<1e-12);
 assert.throws(()=>planCells(boxGeometry({west:20,east:50,south:40,north:60})),/слишком велика/);
});

test('preliminary rules keep missing ownership, CRS and ambiguous housing use unknown',()=>{
 let o=parcel();assert.equal(screenObject(o,boundary).status,'review');assert.equal(screenObject(o,boundary).isCandidate,false);
 o.attributes.ownership_type='Частная';assert.equal(screenObject(o,boundary).status,'excluded');
 o.attributes.ownership_type='';assert.equal(screenObject(o,boundary).status,'unknown');
 o=parcel();o.attributes.permitted_use_established_by_document='Для яслей-сада';assert.equal(screenObject(o,boundary).status,'excluded');
 o.attributes.permitted_use_established_by_document='Для обслуживания жилого дома';assert.equal(screenObject(o,boundary).status,'unknown');
 o=parcel();o.coordinateStatus='inferred';assert.equal(screenObject(o,boundary).status,'unknown');
 o=parcel();o.areaM2=54;assert.equal(screenObject(o,boundary).status,'excluded');
 assert.equal(objectKey(parcel(),'a',0),objectKey({...parcel(),id:'another'},'b',1));
});

test('sequential scan persists cell progress and deduplicates parcels by cadastral number',async()=>{
 let simultaneous=0,max=0;const f=fixture(async(cell)=>{simultaneous++;max=Math.max(max,simultaneous);assert.equal(geometryWithin(cell.geometry,[boundary]),true);await Promise.resolve();simultaneous--;return response([parcel()]);});
 try{f.scanner.start();await waitFor(()=>!f.scanner.isBusy());const s=f.scanner.status().job;assert.equal(s.status,'completed');assert.equal(s.coveragePercent,100);assert.ok(s.requests>1);assert.equal(s.unique,1);assert.equal(s.review,1);assert.equal(s.deduplicated,s.requests-1);assert.equal(max,1);assert.equal(f.scanner.results().objects[0].sightings,s.requests);assert.equal(f.scanner.results({status:'excluded'}).total,0);assert.ok(f.scanner.exportResult().cells.every(c=>c.status==='done'));}finally{f.db.close();}
});

test('pause aborts in-flight request, results survive recreation and resume skips completed cells',async()=>{
 let calls=0,held=false;let f;
 const query=async(cell,signal)=>{calls++;if(calls===2){held=true;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({status:'timeout',message:'aborted'}),{once:true}));}return response([parcel()]);};
 f=fixture(query);
 try{f.scanner.start();await waitFor(()=>held);f.scanner.pause();await waitFor(()=>!f.scanner.isBusy());const before=f.scanner.status().job;assert.equal(before.status,'paused');assert.equal(before.cellsDone,1);assert.equal(before.unique,1);
 const resumed=createNspdScanner({...f.args,query:async()=>response([parcel()])});assert.equal(resumed.status().job.cellsDone,1);resumed.resume();await waitFor(()=>!resumed.isBusy());assert.equal(resumed.status().job.status,'completed');assert.equal(resumed.status().job.requests,before.requests+before.cellsTotal-before.cellsDone);assert.equal(resumed.status().job.unique,1);
 }finally{f.db.close();}
});

test('HTTP 403 is a paused failure, never an empty successful cell or complete coverage',async()=>{
 const f=fixture(async()=>({status:'denied',httpStatus:403,message:'Источник ограничил доступ'}));try{f.scanner.start();await waitFor(()=>!f.scanner.isBusy());const s=f.scanner.status().job;assert.equal(s.status,'paused');assert.equal(s.cellsDone,0);assert.equal(s.coveragePercent,0);assert.equal(s.unique,0);assert.match(s.message,/ограничил/);f.scanner.finish();assert.equal(f.scanner.status().job.status,'completed_partial');}finally{f.db.close();}
});

test('429 honors Retry-After and a changed boundary cannot resume the old run',async()=>{
 const f=fixture(async()=>({status:'limited',httpStatus:429,retryAfter:'60',message:'Лимит источника'}));try{f.scanner.start();await waitFor(()=>!f.scanner.isBusy());assert.throws(()=>f.scanner.resume(),/подождать/);f.tick();const changed=createNspdScanner({...f.args,getTerritory:()=>({...territory(),boundaryVersion:'v2'})});assert.throws(()=>changed.resume(),/граница изменилась/);}finally{f.db.close();}
});

test('truncated or oversized tiles subdivide, bounded final partial tiles are never complete',async()=>{
 let first=true;const f=fixture(async()=>{if(first){first=false;return {...response([parcel()]),possiblyTruncated:true};}return response([]);});try{f.scanner.start();await waitFor(()=>!f.scanner.isBusy());assert.equal(f.scanner.status().job.status,'completed');assert.ok(f.scanner.exportResult().cells.some(c=>c.status==='split'));assert.equal(f.scanner.status().job.unique,1);}finally{f.db.close();}
 const small=boxGeometry({west:35.9,east:35.901,south:54.8,north:54.801});const p=fixture(async()=>({status:'too_large',message:'huge'}));const scanner=createNspdScanner({...p.args,getTerritory:()=>({...territory(),geometry:small})});try{scanner.start();await waitFor(()=>!scanner.isBusy());assert.equal(scanner.status().job.status,'completed_partial');assert.equal(scanner.status().job.coveragePercent,0);assert.ok(scanner.status().job.cellsPartial>0);}finally{p.db.close();}
});

test('a process restart converts running state to a resumable pause without dropping objects',async()=>{
 const f=fixture(async()=>response([parcel()]));try{f.scanner.start();await waitFor(()=>!f.scanner.isBusy());const row=f.db.prepare('SELECT id,payload FROM nspd_scan_runs').get();const job=JSON.parse(row.payload);job.status='running';job.cells[0].status='running';f.db.prepare('UPDATE nspd_scan_runs SET payload=? WHERE id=?').run(JSON.stringify(job),row.id);const resumed=createNspdScanner({...f.args});assert.equal(resumed.status().job.status,'paused');assert.equal(resumed.status().job.unique,1);resumed.resume();await waitFor(()=>!resumed.isBusy());assert.equal(resumed.status().job.status,'completed');assert.equal(resumed.status().job.unique,1);}finally{f.db.close();}
});

test('conflicting source records never become a clean review and previous scans remain accessible',async()=>{
 let count=0;const f=fixture(async()=>{const o=parcel();if(!count++)o.attributes.ownership_type='Частная';return response([o]);});try{f.scanner.start();await waitFor(()=>!f.scanner.isBusy());const oldId=f.scanner.status().job.id;const o=f.scanner.results().objects[0];assert.ok(o.sourceConflicts.includes('ownership_type'));assert.equal(o.screening.status,'unknown');assert.equal(f.scanner.status().job.review,0);f.scanner.start();await waitFor(()=>!f.scanner.isBusy());assert.equal(f.scanner.status().runs.length,2);assert.equal(f.scanner.results({id:oldId}).objects.length,1);assert.equal(f.scanner.exportResult(oldId).job.id,oldId);}finally{f.db.close();}
});
