import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeGeometry,captureFeatures,geometryWithin,geometryOverlaps,assessObject,PILOT_BOUNDS,boxGeometry} from '../src/nspd-geometry.mjs';
const g=boxGeometry({west:35.9500,east:35.9504,south:54.8284,north:54.8288});const R=6378137;const merc={type:'Polygon',coordinates:g.coordinates.map(r=>r.map(([x,y])=>[x*Math.PI/180*R,Math.log(Math.tan(Math.PI/4+y*Math.PI/360))*R]))};
test('explicit WGS84 and Web Mercator normalize to the same region',()=>{const a=normalizeGeometry(g,'EPSG:4326'),b=normalizeGeometry(merc,{properties:{name:'urn:ogc:def:crs:EPSG::3857'}});assert.equal(a.coordinateStatus,'declared');assert.equal(b.coordinateStatus,'declared');assert.ok(Math.abs(a.geometry.coordinates[0][0][0]-b.geometry.coordinates[0][0][0])<1e-8);});
test('missing CRS remains explicitly inferred and invalid/out-of-area rings never render',()=>{assert.equal(normalizeGeometry(merc,null).coordinateStatus,'inferred');assert.equal(normalizeGeometry(g,null).sourceCRS,'EPSG:4326');assert.equal(normalizeGeometry(g,'EPSG:9999').geometry,null);const swapped={type:'Polygon',coordinates:g.coordinates.map(r=>r.map(([x,y])=>[y,x]))};assert.equal(normalizeGeometry(swapped,'EPSG:4326').geometry,null);assert.equal(normalizeGeometry({type:'Polygon',coordinates:[[[1,1],[2,2],[3,3],[1,1]]]},null).geometry,null);assert.equal(normalizeGeometry({type:'Polygon',coordinates:[[[35,54],[36,54],[36,55],[35,55]]]},null).geometry,null);});
test('preserves raw geometry and source attributes, never converts missing area or cost to zero',()=>{const f={id:12,geometry:merc,properties:{label:'40:04:000000:1',options:{specified_area:'1 200',cad_num:'40:04:000000:1',ownership_type:'Не установлено',unrelated_secret:'should not be exported'}}};const [o]=captureFeatures([f],{layer:{id:'36048',categoryId:36368},checkedAt:'2026-11-21',sourceURL:'https://nspd.gov.ru/api/test'});assert.equal(o.areaM2,1200);assert.equal(o.attributes.cost_value,undefined);assert.equal(o.attributes.unrelated_secret,undefined);assert.deepEqual(o.sourceGeometry.coordinates,merc.coordinates);assert.equal(o.isCandidate,false);const [empty]=captureFeatures([{id:13,geometry:g,properties:{}}],{layer:{id:'36048',categoryId:36368},checkedAt:'2026-11-21',sourceURL:'source'});assert.equal(empty.areaM2,null);});
test('containment respects holes and concave boundary rather than merely vertices/bounding box',()=>{const outer=boxGeometry({west:35.949,east:35.952,south:54.827,north:54.830});const hole=boxGeometry({west:35.9499,east:35.9505,south:54.8283,north:54.8289});const boundary={type:'Polygon',coordinates:[outer.coordinates[0],hole.coordinates[0]]};assert.equal(geometryWithin(g,[outer]),true);assert.equal(geometryWithin(g,[boundary]),false);const concave={type:'Polygon',coordinates:[[[35.949,54.827],[35.952,54.827],[35.952,54.830],[35.95025,54.830],[35.95025,54.8285],[35.95015,54.8285],[35.95015,54.830],[35.949,54.830],[35.949,54.827]]]};assert.equal(geometryWithin(g,[concave]),false);assert.equal(geometryOverlaps(g,hole),true);const distant=boxGeometry({west:35.96,east:35.961,south:54.83,north:54.831});assert.equal(geometryOverlaps(g,distant),false);});
test('empty boundary, incomplete coverage and missing layers do not become clearance',()=>{const object={geometry:g,coordinateStatus:'declared'};let checks=assessObject(object,[],[]);assert.ok(checks.every(c=>c.status==='unknown'));checks=assessObject(object,[{layerId:'875831',categoryId:472812,checkedAt:'2026-11-21',objects:[],scope:PILOT_BOUNDS}],[]);assert.equal(checks[0].status,'unknown');const partial={layerId:'37294',categoryId:38943,checkedAt:'2026-11-21',objects:[],scope:PILOT_BOUNDS,partial:true};assert.equal(assessObject(object,[partial],[]).find(c=>c.key==='schemes').status,'unknown');});
test('inferred coordinates remain preliminary even inside loaded settlement polygon',()=>{const outer=boxGeometry({west:35.949,east:35.952,south:54.827,north:54.830});const s={layerId:'875831',categoryId:472812,checkedAt:'2026-11-21',objects:[{id:'town',geometry:outer,coordinateStatus:'declared'}],scope:PILOT_BOUNDS};const c=assessObject({geometry:g,coordinateStatus:'inferred'},[s],[]);assert.equal(c[0].status,'preliminary');const current=[{id:'875831',observation:{status:'denied'}}];assert.equal(assessObject({geometry:g,coordinateStatus:'declared'},[s],current)[0].status,'unknown');});

test('interior sample respects a concave settlement, holes and a narrow multipolygon',async()=>{
 const {interiorSample}=await import('../src/nspd-geometry.mjs');
 const outer=boxGeometry({west:35.9,east:36,south:54.8,north:54.9});
 const hole=boxGeometry({west:35.93,east:35.97,south:54.83,north:54.87});
 const boundary={type:'Polygon',coordinates:[outer.coordinates[0],hole.coordinates[0]]};
 const sample=interiorSample(boundary);
 assert.equal(geometryWithin(sample.geometry,[boundary]),true);
 assert.equal(geometryOverlaps(sample.geometry,hole),false);
 const narrow=boxGeometry({west:35.95,east:35.95001,south:54.82,north:54.821});
 const clipped=interiorSample({type:'MultiPolygon',coordinates:[narrow.coordinates]});
 assert.equal(geometryWithin(clipped.geometry,[narrow]),true);
 assert.ok(clipped.scope.east-clipped.scope.west<=.000011);
});

test('constraint clearance uses clipped query geometry, not its bounding rectangle',()=>{
 const small=boxGeometry({west:35.9500,east:35.9501,south:54.8284,north:54.8285});
 const s={layerId:'37294',categoryId:38943,checkedAt:'2026-11-21',objects:[],scope:PILOT_BOUNDS,queryGeometry:small};
 assert.equal(assessObject({geometry:g,coordinateStatus:'declared'},[s],[]).find(c=>c.key==='schemes').status,'unknown');
});
