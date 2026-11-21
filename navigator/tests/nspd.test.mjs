import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createNspdService} from '../server/nspd.mjs';
const fixture=(fetchImpl)=>{const db=new DatabaseSync(':memory:');let t=100000;return {db,nspd:createNspdService({db,fetchImpl,clock:()=>t}),tick(){t+=30001}}};
test('map availability does not prove API access and source failures are not empty results',async()=>{const f=fixture(async url=>url.pathname==='/map'?new Response('map'):new Response('unavailable',{status:503}));try{const r=await f.nspd.probe();assert.equal(r.confirmedData,false);assert.equal(r.results[0].status,'reachable');assert.equal(r.results[1].status,'unavailable');assert.equal(r.results[1].count,undefined);assert.equal(f.nspd.overview().report.confirmedData,false);}finally{f.db.close();}});
test('returns real feature preview, bounded area, no cookies and reference origin only',async()=>{let call;const f=fixture(async(url,options)=>{call={url,options};return Response.json({features:[{id:42,properties:{label:'Участок из источника'},geometry:{type:'Polygon',coordinates:[]}}]});});try{const r=await f.nspd.layer('36048');assert.equal(r.count,1);assert.equal(r.preview[0].name,'Участок из источника');assert.equal(r.status,'available');assert.equal(call.url.origin,'https://nspd.gov.ru');assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.cookie,undefined);const body=JSON.parse(call.options.body);assert.equal(body.categories[0].id,36368);const ring=body.geom.features[0].geometry.coordinates[0];assert.ok(ring[2][0]-ring[0][0]<.01);assert.equal(f.nspd.overview().layers.find(l=>l.id==='36048').observation.count,1);await assert.rejects(f.nspd.layer('https://evil.example'),/Неизвестный/);}finally{f.db.close();}});
test('empty successful response is explicitly only local sample, HTML is invalid',async()=>{const f=fixture(async()=>Response.json({features:[]}));try{const r=await f.nspd.layer('36048');assert.equal(r.count,0);assert.match(r.message,/не доказательство/);const g=fixture(async()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}));try{assert.equal((await g.nspd.layer('36048')).status,'invalid');}finally{g.db.close();}}finally{f.db.close();}});
test('authorization, blocked source, rate limits and certificate failures remain distinct',async()=>{for(const [http,status]of [[401,'authorization'],[403,'denied'],[429,'limited']]){const f=fixture(async()=>new Response('',{status:http}));try{const r=await f.nspd.layer('36048');assert.equal(r.status,status);assert.equal(r.count,undefined);}finally{f.db.close();}}const f=fixture(async()=>{throw Object.assign(Error('fetch failed'),{cause:Error('unable to verify certificate')})});try{assert.equal((await f.nspd.layer('36048')).status,'certificate');}finally{f.db.close();}});
test('limits repeated queries, preserves observations across service restarts and marks shared categories',async()=>{const fetchImpl=async()=>Response.json({features:[]}),f=fixture(fetchImpl);try{const r=await f.nspd.layer('37577');assert.equal(r.categoryShared,true);await assert.rejects(f.nspd.layer('37577'),/30 секунд/);f.tick();await f.nspd.layer('37577');const resumed=createNspdService({db:f.db,fetchImpl});assert.equal(resumed.overview().layers.find(l=>l.id==='37577').observation.status,'available');}finally{f.db.close();}});
test('oversized source response rejected without treating it as data',async()=>{const f=fixture(async()=>new Response('huge',{headers:{'content-length':'4000000'}}));try{const r=await f.nspd.layer('36048');assert.equal(r.status,'too_large');assert.equal(r.count,undefined);}finally{f.db.close();}});
test('stores original geometry and attributes in snapshot, keeps last successful snapshot on HTTP failure',async()=>{let fail=false;const coordinates=[[[35.95,54.8284],[35.9504,54.8284],[35.9504,54.8288],[35.95,54.8288],[35.95,54.8284]]];const f=fixture(async()=>fail?new Response('denied',{status:403}):Response.json({crs:{properties:{name:'EPSG:4326'}},features:[{id:4,geometry:{type:'Polygon',coordinates},properties:{label:'40:04:000000:4',options:{area:900,cost_value:100000}}}]}));try{await f.nspd.layer('36048');let r=f.nspd.objects('36048');assert.equal(r.objects[0].areaM2,900);assert.equal(r.objects[0].geometry.type,'Polygon');assert.deepEqual(r.objects[0].sourceGeometry.coordinates,coordinates);assert.equal(f.nspd.overview().accessSummary.layerDataReceived,true);assert.equal(f.nspd.overview().accessSummary.searchAvailable,false);assert.equal(r.stale,false);f.tick();fail=true;await f.nspd.layer('36048');r=f.nspd.objects('36048');assert.equal(r.objects.length,1);assert.equal(r.stale,true);const resumed=createNspdService({db:f.db,fetchImpl:async()=>{throw Error('not used')}});assert.equal(resumed.objects('36048').objects[0].attributes.cost_value,100000);}finally{f.db.close();}});
test('snapshot histories are bounded, empty later response replaces current content honestly',async()=>{let features=[];const f=fixture(async()=>Response.json({features}));try{for(let i=0;i<5;i++){f.tick();await f.nspd.layer('36048');}assert.equal(f.db.prepare('SELECT COUNT(*) n FROM nspd_snapshot_history').get().n,3);assert.equal(f.nspd.objects('36048').objects.length,0);assert.ok(f.nspd.objects('36048').snapshot);await assert.rejects(f.nspd.layer('875882'),/Неизвестный/);}finally{f.db.close();}});

test('discovers settlement polygons in larger envelope and queries only selected boundary interior',async()=>{
 const {boxGeometry,geometryWithin}=await import('../src/nspd-geometry.mjs');
 const town=boxGeometry({west:35.92,east:35.96,south:54.80,north:54.82}),other=boxGeometry({west:35.97,east:35.98,south:54.80,north:54.81});
 const calls=[];
 const f=fixture(async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  const features=body.categories[0].id===472812?[
   {id:77,geometry:{...town,crs:{properties:{name:'EPSG:4326'}}},properties:{label:'Полигон 77',options:{brd_nmb:'40:04-test',name:'Тестовый город'}}},
   {id:78,geometry:{...other,crs:{properties:{name:'EPSG:4326'}}},properties:{label:'Соседний полигон'}}
  ]:[];
  return Response.json({features});
 });
 try{
  await f.nspd.findBoundary();const d=f.nspd.overview().boundaryDiscovery;
  assert.equal(d.choices.length,2);assert.equal(d.choices[0].attributes.brd_nmb,'40:04-test');
  assert.equal(f.nspd.overview().territory,null);
  assert.throws(()=>f.nspd.selectTerritory('77','wrong-version'),/изменился/);
  assert.throws(()=>f.nspd.selectTerritory('unknown',d.version),/полигон/);
  f.nspd.selectTerritory('77',d.version);
  const chosen=f.nspd.overview().territory;assert.equal(chosen.usable,true);
  assert.equal(geometryWithin(chosen.queryGeometry,[town]),true);
  await f.nspd.layer('36048');
  assert.equal(geometryWithin(calls[1].geom.features[0].geometry,[town]),true);
  const snap=f.nspd.objects('36048').snapshot;assert.equal(snap.territoryId,'77');assert.equal(snap.count,0);
  assert.equal(f.nspd.objects('36048').scopeChanged,false);
  // Reloading the default boundary checkbox must preserve selected geometry/version.
  await f.nspd.layer('875831');assert.equal(calls.length,2);
  const resumed=createNspdService({db:f.db,fetchImpl:async()=>{throw Error('no request')}});
  assert.equal(resumed.overview().territory.id,'77');assert.equal(resumed.overview().territory.usable,true);
  f.nspd.selectTerritory('78',d.version);assert.equal(f.nspd.objects('36048').scopeChanged,true);
 }finally{f.db.close();}
});

test('failed or replaced boundary cannot silently start a search using old selection',async()=>{
 const {boxGeometry}=await import('../src/nspd-geometry.mjs');
 let denied=false;
 const town=boxGeometry({west:35.92,east:35.96,south:54.80,north:54.82});
 const f=fixture(async()=>denied?new Response('denied',{status:403}):Response.json({features:[{id:77,geometry:town,crs:{properties:{name:'EPSG:4326'}},properties:{label:'Тестовый полигон'}}]}));
 try{
  await f.nspd.findBoundary();let d=f.nspd.overview().boundaryDiscovery;f.nspd.selectTerritory('77',d.version);
  f.tick();denied=true;await f.nspd.findBoundary();
  assert.equal(f.nspd.overview().territory.usable,false);
  assert.equal(f.nspd.objects('875831').objects.length,1);
  assert.throws(()=>f.nspd.selectTerritory('77',d.version),/неуспешна/);
  await assert.rejects(f.nspd.layer('36048'),/подтверждения/);
  f.tick();denied=false;await f.nspd.findBoundary();
  assert.equal(f.nspd.overview().territory.usable,false);
  d=f.nspd.overview().boundaryDiscovery;f.nspd.selectTerritory('77',d.version);
  assert.equal(f.nspd.overview().territory.usable,true);
 }finally{f.db.close();}
});

test('empty or inferred boundary remains unselected and never receives a fabricated town label',async()=>{
 const {boxGeometry}=await import('../src/nspd-geometry.mjs');
 const f=fixture(async()=>Response.json({features:[{id:77,geometry:boxGeometry({west:35.92,east:35.96,south:54.80,north:54.82}),properties:{label:'40-test'}}]}));
 try{await f.nspd.findBoundary();const d=f.nspd.overview().boundaryDiscovery;assert.equal(d.choices[0].selectable,false);assert.equal(d.choices[0].name,'40-test');assert.throws(()=>f.nspd.selectTerritory('77',d.version),/системой координат/);assert.equal(f.nspd.overview().territory,null);}finally{f.db.close();}
 const e=fixture(async()=>Response.json({features:[]}));try{await e.nspd.findBoundary();assert.equal(e.nspd.overview().boundaryDiscovery.choices.length,0);assert.equal(e.nspd.overview().territory,null);}finally{e.db.close();}
});

test('scanner uses the existing fixed NSPD request path and blocks simultaneous layer edits',async()=>{
 const {boxGeometry,geometryWithin}=await import('../src/nspd-geometry.mjs');
 const town=boxGeometry({west:35.92,east:35.925,south:54.80,north:54.802});let sourceCall,release;
 const f=fixture(async(url,options)=>{const body=JSON.parse(options.body);if(body.categories[0].id===472812)return Response.json({features:[{id:77,geometry:{...town,crs:{properties:{name:'EPSG:4326'}}},properties:{label:'Контрольный город'}}]});sourceCall={url,options,body};await new Promise(resolve=>release=resolve);return Response.json({features:[]});});
 try{await f.nspd.findBoundary();f.nspd.selectTerritory('77',f.nspd.overview().boundaryDiscovery.version);f.nspd.scanner.start();assert.equal(sourceCall.url.origin,'https://nspd.gov.ru');assert.equal(sourceCall.body.categories[0].id,36368);assert.equal(sourceCall.options.credentials,'omit');assert.equal(sourceCall.options.redirect,'error');assert.equal(geometryWithin(sourceCall.body.geom.features[0].geometry,[town]),true);await assert.rejects(f.nspd.layer('36048'),/паузу/);assert.throws(()=>f.nspd.selectTerritory('77','wrong'),/паузу/);f.nspd.scanner.pause();release();for(let i=0;i<100&&f.nspd.scanner.isBusy();i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.nspd.scanner.status().job.status,'paused');assert.equal(f.nspd.scanner.status().job.cellsDone,0);}finally{f.db.close();}
});

test('parcel reviews reuse the fixed NSPD endpoint with full geometry and exclude competing source tasks',async()=>{
 const {boxGeometry}=await import('../src/nspd-geometry.mjs');const g=boxGeometry({west:35.95,east:35.9503,south:54.8,north:54.8003});let captured,release;
 const f=fixture(async(url,options)=>{captured={url,options,body:JSON.parse(options.body)};await new Promise(resolve=>release=resolve);return Response.json({features:[]});});
 try{const source={id:'source',status:'completed',territory:{id:'town',name:'Контрольная граница'},createdAt:'2026-11-21T10:00:00Z',updatedAt:'2026-11-21T10:08:00Z'};f.db.prepare('INSERT INTO nspd_scan_runs(id,payload) VALUES(?,?)').run('source',JSON.stringify(source));const o={id:'p1',name:'40:04:000001:1',geometry:g,coordinateStatus:'declared',attributes:{cad_num:'40:04:000001:1'},hasStableSourceId:true};f.db.prepare('INSERT INTO nspd_scan_objects(run_id,object_key,screen_status,payload) VALUES(?,?,?,?)').run('source','cad:40:04:000001:1','review',JSON.stringify(o));
 f.nspd.reviewer.start('source');assert.equal(captured.url.origin,'https://nspd.gov.ru');assert.equal(captured.url.pathname,'/api/geoportal/v1/intersects');assert.equal(captured.body.categories[0].id,36369);assert.deepEqual(captured.body.geom.features[0].geometry.coordinates,g.coordinates);assert.equal(captured.options.credentials,'omit');assert.equal(captured.options.redirect,'error');await assert.rejects(f.nspd.layer('36048'),/паузу/);assert.throws(()=>f.nspd.scanner.start(),/паузу/);assert.throws(()=>f.nspd.selectTerritory('unknown','unknown'),/паузу/);f.nspd.reviewer.pause();release();for(let i=0;i<100&&f.nspd.reviewer.isBusy();i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.nspd.reviewer.status().job.status,'paused');assert.equal(f.nspd.reviewer.status().job.tasksDone,0);
 }finally{f.db.close();}
});

test('zone card search uses exact registry, dedicated theme and fixed origin without cookies',async()=>{let call;const f=fixture(async(url,options)=>{call={url,options};return Response.json({data:{features:[{id:'new',properties:{label:'40:04-7.631',options:{reg_numb_border:'40:04-7.631',name_by_doc:'Контрольная зона'}}}]}})});try{const job={id:'r',territory:{name:'Контрольная территория'},parcels:[{id:'p',name:'40:04:000001:1'}]};f.db.prepare('INSERT INTO nspd_review_runs(id,payload) VALUES(?,?)').run('r',JSON.stringify(job));f.db.prepare('INSERT INTO nspd_review_checks(run_id,parcel_id,category_id,status,incomplete,payload) VALUES(?,?,?,?,?,?)').run('r','p',472819,'intersection',0,JSON.stringify({key:'zoning',matches:[{id:'zone',name:'40:04-7.631',attributes:{reg_numb_border:'40:04-7.631'}}]}));const r=await f.nspd.zoneCards.fetchCard('r','zoning:40:04-7.631');assert.equal(call.url.origin,'https://nspd.gov.ru');assert.equal(call.url.pathname,'/api/geoportal/v2/search/geoportal');assert.equal(call.url.searchParams.get('thematicSearchId'),'7');assert.equal(call.url.searchParams.get('query'),'40:04-7.631');assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');assert.equal(r.targets[0].state.lastSuccess.records[0].attributes.name_by_doc,'Контрольная зона');await assert.rejects(f.nspd.zoneCards.fetchCard('r','zoning:40:04-7.631'),/30 секунд/);}finally{f.db.close();}});
