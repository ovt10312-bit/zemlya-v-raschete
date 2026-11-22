import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {formationOptions,prepareFormation,findFormationInCell,formationVerdict,formationTriage} from '../src/nspd-formation-domain.mjs';
import {boxGeometry,geometryWithin,geometryOverlaps} from '../src/nspd-geometry.mjs';
import {geometryArea} from '../src/nspd-scan-domain.mjs';
import {createNspdFormation} from '../server/nspd-formation.mjs';
const box=(x,y,w,h)=>boxGeometry({west:35.9+x/63700,east:35.9+(x+w)/63700,south:54.8+y/111195,north:54.8+(y+h)/111195});
const boundary=box(0,0,200,200);
const parcel=(geometry=box(0,0,90,200))=>({id:'existing',geometry,coordinateStatus:'declared',attributes:{ownership_type:'Частная'},screening:{status:'excluded'}});
function scan(){return {id:'scan',status:'completed',updatedAt:'2026-11-21T15:00:00Z',territory:{id:'town',name:'Контрольная граница',geometry:boundary},cells:[{id:'a',scope:{west:35.9,east:35.9+200/63700,south:54.8,north:54.8+200/111195},geometry:boundary,status:'done',sourceStatus:'available',httpStatus:200}]};}
async function waitFor(fn){for(let i=0;i<800;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}throw Error('Timeout')}
function fixture(query=async()=>({status:'available',checkedAt:'2026-11-21T16:00:00Z',httpStatus:200,count:0,objects:[]})){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE nspd_scan_runs(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE nspd_scan_objects(run_id TEXT,payload TEXT);');db.prepare('INSERT INTO nspd_scan_runs VALUES(?,?)').run('scan',JSON.stringify(scan()));db.prepare('INSERT INTO nspd_scan_objects VALUES(?,?)').run('scan',JSON.stringify(parcel()));const args={db,query,gapMs:0};return {db,args,service:createNspdFormation(args)};
}
test('formation uses every cadastral contour, including private, rejected, and oversized parcels',()=>{
 const s=scan(),obstacle=parcel(),plan=prepareFormation(s,[obstacle]),p=findFormationInCell(plan.cells[0],plan.obstacles,formationOptions({minArea:6,maxArea:6}));
 assert.ok(p);assert.equal(p.areaM2,600);assert.equal(geometryWithin(p.geometry,[boundary]),true);assert.equal(geometryOverlaps(p.geometry,obstacle.geometry),false);assert.equal(p.geometryOrigin,'generated');assert.equal(p.legalAvailability,'unknown');assert.equal(formationVerdict(p).isCandidate,false);
 const [lng,lat]=p.centre,sy=6371008.8*Math.PI/180,sx=sy*Math.cos(lat*Math.PI/180);const metric={type:'Polygon',coordinates:p.geometry.coordinates.map(r=>r.map(([x,y])=>[(x-lng)*sx,(y-lat)*sy]))};assert.ok(Math.abs(geometryArea(metric)-600)<.1);
 const full=prepareFormation(s,[parcel(boundary)]);assert.equal(findFormationInCell(full.cells[0],full.obstacles,formationOptions()),null);
});
test('formation respects holes and disconnected fragments; a narrow strip is not an area-sized parcel',()=>{
 const hole=box(50,50,100,100),s=scan();s.territory.geometry={type:'Polygon',coordinates:[boundary.coordinates[0],hole.coordinates[0]]};s.cells[0].geometry=s.territory.geometry;
 const p=prepareFormation(s,[]),r=findFormationInCell(p.cells[0],p.obstacles,formationOptions());assert.ok(r);assert.equal(geometryWithin(r.geometry,[s.territory.geometry]),true);assert.equal(geometryOverlaps(r.geometry,hole),false);
 const sliver=box(0,0,8,200),c={geometry:sliver,scope:s.cells[0].scope};assert.equal(findFormationInCell(c,[],formationOptions()),null);
 const islands={type:'MultiPolygon',coordinates:[box(0,0,30,30).coordinates,box(100,100,30,30).coordinates]};const r2=findFormationInCell({...c,geometry:islands},[],formationOptions({minArea:6,maxArea:6}));assert.ok(r2);assert.equal(geometryWithin(r2.geometry,[islands]),true);
});
test('reported 100 percent never bypasses missing cells, CRS, coverage or source errors',()=>{
 assert.throws(()=>formationOptions({minArea:5}),/6 до 20/);assert.throws(()=>formationOptions({minArea:20,maxArea:6}),/6 до 20/);assert.throws(()=>formationOptions({usage:'Магазин'}),/цель/);
 const bad=scan();bad.cells[0].geometry=box(0,0,100,200);assert.throws(()=>prepareFormation(bad,[]),/не покрывает/);
 const partial=scan();partial.cells[0].status='partial';assert.throws(()=>prepareFormation(partial,[]),/неполученные/);
 const o=parcel();o.coordinateStatus='inferred';assert.throws(()=>prepareFormation(scan(),[o]),/контуры/);o.coordinateStatus='declared';o.sourceConflicts=['area'];assert.throws(()=>prepareFormation(scan(),[o]),/противоречия/);
});
test('persisted local search uses worker, performs zero source requests, survives recreation and preserves old scans',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('Unexpected source call')});try{
  f.service.start({minArea:6,maxArea:20});assert.equal(f.service.isBusy(),true);await waitFor(()=>!f.service.isBusy());const d=f.service.result();assert.equal(d.job.status,'completed');assert.equal(calls,0);assert.equal(d.job.networkRequests,0);assert.equal(d.job.proposals.length,1);assert.equal(d.job.nextIndex,1);
  const again=createNspdFormation(f.args);assert.equal(again.result().job.proposals[0].id,d.job.proposals[0].id);assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM nspd_scan_runs').get().payload).status,'completed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM nspd_scan_objects').get().n,1);
 }finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});
test('selected generated contour gets eight exact full-geometry checks, empty source is never approval',async()=>{
 let active=0,max=0;const categories=[];const f=fixture(async(p,c)=>{active++;max=Math.max(max,active);categories.push(c.key);assert.equal(p.geometryOrigin,'generated');await Promise.resolve();active--;return {status:'available',checkedAt:'2026-11-21T16:00:00Z',httpStatus:200,count:0,objects:[]}});try{
  f.service.start();await waitFor(()=>!f.service.isBusy());const id=f.service.result().job.proposals[0].id;assert.throws(()=>f.service.check('arbitrary'),/не найден/);f.service.check(id);await waitFor(()=>!f.service.isBusy());const j=f.service.result().job,p=j.proposals[0];assert.equal(j.networkRequests,8);assert.equal(new Set(categories).size,8);assert.equal(categories.includes('thirdParty'),false);assert.equal(max,1);assert.equal(p.checks.length,8);assert.ok(p.checks.every(c=>c.status==='sample_only'&&c.legalAvailability==='unknown'));assert.equal(p.verdict.legalAvailability,'unknown');assert.equal(p.withoutAuction,'unconfirmed');assert.ok(p.verdict.pending.length>=6);
 }finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});
test('403 pauses exact selected-contour task; resume skips prior responses and keeps legal uncertainty',async()=>{
 let denied=true,calls=0;const f=fixture(async()=>{calls++;return calls===2&&denied?{status:'denied',httpStatus:403,message:'Источник ограничил доступ'}:{status:'available',checkedAt:'2026-11-21T16:00:00Z',httpStatus:200,count:0,objects:[]}});try{
  f.service.start();await waitFor(()=>!f.service.isBusy());f.service.check(f.service.result().job.proposals[0].id);await waitFor(()=>!f.service.isBusy());let j=f.service.result().job;assert.equal(j.status,'paused');assert.equal(j.proposals[0].checks.length,1);assert.equal(j.lastFailure.httpStatus,403);
  denied=false;const again=createNspdFormation(f.args);again.resume();await waitFor(()=>!again.isBusy());j=again.result().job;assert.equal(calls,9);assert.equal(j.proposals[0].checks.length,8);assert.equal(j.proposals[0].verdict.legalAvailability,'unknown');
 }finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});
test('local search pause preserves the boundary, history and only accepts a complete nonempty source',async()=>{
 const f=fixture();try{f.service.start();f.service.pause();assert.equal(f.service.result().job.status,'paused');await new Promise(r=>setTimeout(r,30));assert.equal(f.service.result().job.proposals.length,0);f.service.resume();await waitFor(()=>!f.service.isBusy());assert.equal(f.service.result().job.status,'completed');const id=f.service.result().job.id;f.service.start({minArea:6,maxArea:6});await waitFor(()=>!f.service.isBusy());assert.equal(f.service.result().runs.length,2);assert.equal(f.service.result(id).job.id,id);
  f.db.prepare('DELETE FROM nspd_scan_objects').run();assert.throws(()=>f.service.start(),/Пустой обход/);
 }finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});

test('formation 429 survives recreation and cannot be bypassed by starting another local search',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {status:'limited',httpStatus:429,retryAfter:'60',message:'Limit'}});try{f.service.start();await waitFor(()=>!f.service.isBusy());f.service.check(f.service.result().job.proposals[0].id);await waitFor(()=>!f.service.isBusy());assert.equal(calls,1);assert.ok(f.service.result().job.retryAt>Date.now());const again=createNspdFormation(f.args);assert.throws(()=>again.resume(),/подождать/);again.start();await waitFor(()=>!again.isBusy());assert.throws(()=>again.check(again.result().job.proposals[0].id),/подождать/);assert.equal(calls,1);}finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});

test('pausing an in-flight formation check preserves the exact pending category',async()=>{
 let release,calls=0;const f=fixture(async(p,c,signal)=>{calls++;return new Promise(resolve=>{release=()=>resolve({status:'available',httpStatus:200,count:0,objects:[]});signal.addEventListener('abort',()=>resolve({status:'timeout',message:'aborted'}),{once:true})})});try{f.service.start();await waitFor(()=>!f.service.isBusy());f.service.check(f.service.result().job.proposals[0].id);assert.equal(calls,1);f.service.pause();await waitFor(()=>!f.service.isBusy());assert.equal(f.service.result().job.proposals[0].checks,undefined);assert.equal(f.service.result().job.networkRequests,0);f.service.resume();assert.equal(calls,2);f.service.pause();release();await waitFor(()=>!f.service.isBusy());assert.equal(f.service.result().job.proposals[0].checks,undefined);}finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});

test('resume after the final saved fragment completes rather than leaving an empty worker paused',async()=>{
 const f=fixture();try{f.service.start();await waitFor(()=>!f.service.isBusy());const j=f.service.result().job;j.status='paused';f.db.prepare('UPDATE nspd_formation_runs SET payload=? WHERE id=?').run(JSON.stringify(j),j.id);const again=createNspdFormation(f.args);again.resume();await waitFor(()=>!again.isBusy());assert.equal(again.result().job.status,'completed');assert.equal(again.result().job.proposals.length,1);}finally{f.service.pause();await waitFor(()=>!f.service.isBusy());f.db.close()}
});


test('known ZOUIT or infrastructure intersections exclude a formation from the requested shortlist',()=>{
 for(const key of ['buildings','structures','unfinished','schemes','planning','restrictions','processes']){const p={checks:[{key,name:'Контрольная категория',status:'intersection',incomplete:false}]};const t=formationTriage(p);assert.equal(t.status,'conflict');assert.equal(t.label,'Исключён из подбора');assert.deepEqual(t.reasons,['Контрольная категория']);}
});
test('unchecked, partial and unknown categories never become eligible parcels',()=>{
 assert.equal(formationTriage({}).status,'unverified');assert.equal(formationTriage({checks:[{key:'zoning',status:'intersection'}]}).status,'unverified');
 const keys=['buildings','structures','unfinished','schemes','planning','restrictions','processes','zoning'];const checks=keys.map(key=>({key,status:key==='zoning'?'intersection':'sample_only',incomplete:key==='restrictions'}));assert.equal(formationTriage({checks}).status,'unverified');
});
test('an empty zoning response does not confirm IZS or LPH compatibility',()=>{
 const keys=['buildings','structures','unfinished','schemes','planning','restrictions','processes','zoning'];const t=formationTriage({checks:keys.map(key=>({key,status:'sample_only',incomplete:false}))});assert.equal(t.status,'unverified');assert.equal(t.label,'Зона не определена');
});
test('complete geometric responses with a zoning hit still require the actual zoning regulation',()=>{
 const keys=['buildings','structures','unfinished','schemes','planning','restrictions','processes','zoning'];const t=formationTriage({checks:keys.map(key=>({key,status:key==='zoning'?'intersection':'sample_only',incomplete:false}))});assert.equal(t.status,'zone_pending');assert.equal(t.label,'Нужен регламент зоны');assert.notEqual(t.status,'approved');
});
