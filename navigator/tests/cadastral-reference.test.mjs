import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cadastralReference} from '../src/cadastral-reference.mjs';
import {boxGeometry} from '../src/nspd-geometry.mjs';
const boundary=boxGeometry({west:35,east:36,south:54,north:55});
function parcel(index,{area=1000,cost=200000,usage='Для индивидуального жилищного строительства',geometry=boxGeometry({west:35.1,east:35.101,south:54.1,north:54.101}),...extra}={}){
 return {id:'source-'+index,layerId:'36048',categoryId:36368,name:`40:04:010802:${index}`,coordinateStatus:'declared',geometry,hasStableSourceId:true,areaM2:area,checkedAt:'2026-11-21T10:00:00Z',sourceURL:'https://nspd.gov.ru/api/geoportal/v1/intersects?typeIntersect=fullObject',sourceConflicts:[],attributes:{cad_num:`40:04:010802:${index}`,cost_value:cost,specified_area:area,permitted_use_established_by_document:usage,land_record_category_type:'Земли населенных пунктов',cost_application_date:'2023-01-01',ownership_type:'Частная'},...extra};
}
const options={boundary,settlement:'Кондрово',region:'Калужская область',usage:'ИЖС',sourceScanId:'saved-scan'};

test('official total cost is normalized per sotka before arithmetic average, keeping weighted/median separate',()=>{
 const result=cadastralReference([parcel(1,{area:600,cost:60000}),parcel(2),parcel(3,{area:2000,cost:600000})],{...options,targetAreaM2:800});
 assert.equal(result.status,'available');assert.equal(result.sampleCount,3);assert.equal(result.meanPerSotka,20000);assert.equal(result.medianPerSotka,20000);assert.equal(result.weightedMeanPerSotka,23888.888889);assert.equal(result.estimatedTotal,160000);assert.deepEqual(result.economics,{cadastrePerSotka:20000});assert.equal(result.unit,'RUB/sotka');assert.equal(result.sourceScanId,'saved-scan');assert.equal(result.sourceCheckedAt.oldest,'2026-11-21T10:00:00Z');assert.ok(!('rent' in result.economics));
});
test('missing and malformed values never become zero; explicit ruble and square-metre strings use source units',()=>{
 const good=parcel(1,{area:'1 000,00 м²',cost:'200 000,50 руб.'});
 const unknown=parcel(2,{cost:null}),wrongUnit=parcel(3,{cost:'200 руб./м²'}),wrongArea=parcel(4,{area:'10 соток'}),zero=parcel(5,{cost:0});
 const result=cadastralReference([good,unknown,wrongUnit,wrongArea,zero],options);
 assert.equal(result.sampleCount,1);assert.equal(result.meanPerSotka,20000.05);assert.equal(result.status,'insufficient_data');assert.equal(result.excluded.missing_cost,3);assert.equal(result.excluded.missing_area,1);
 const empty=cadastralReference([unknown],options);assert.equal(empty.meanPerSotka,null);assert.equal(empty.economics.cadastrePerSotka,null);assert.equal(empty.estimatedTotal,null);
});
test('all objects must have declared geometry wholly inside the real settlement boundary, including its holes',()=>{
 const hole=[[35.2,54.2],[35.3,54.2],[35.3,54.3],[35.2,54.3],[35.2,54.2]];
 const withHole={type:'Polygon',coordinates:[boundary.coordinates[0],hole]};
 const objects=[parcel(1),parcel(2,{geometry:boxGeometry({west:35.22,east:35.23,south:54.22,north:54.23})}),parcel(3,{geometry:boxGeometry({west:35.9,east:36.1,south:54.1,north:54.2})}),parcel(4,{coordinateStatus:'inferred'}),parcel(5,{geometry:null})];
 const result=cadastralReference(objects,{...options,boundary:withHole});assert.equal(result.sampleCount,1);assert.equal(result.excluded.outside_boundary,2);assert.equal(result.excluded.unconfirmed_geometry,2);
 assert.equal(cadastralReference(objects,{...options,boundary:null}).meanPerSotka,null);
});
test('usage matching is explicit: generic household plots require settlement land category and field household plots are excluded',()=>{
 const generic=parcel(1,{usage:'Для ведения личного подсобного хозяйства'}),field=parcel(2,{usage:'Для ведения личного подсобного хозяйства (полевой земельный участок)'}),unknown=parcel(3,{usage:'Для ведения личного подсобного хозяйства'});unknown.attributes.land_record_category_type='Земли сельскохозяйственного назначения';
 const explicit=parcel(4,{usage:'Для ведения личного подсобного хозяйства (приусадебный земельный участок)'}),garden=parcel(5,{usage:'Для ведения садоводства'});
 const result=cadastralReference([generic,field,unknown,explicit,garden],{...options,usage:'Приусадебное ЛПХ'});assert.equal(result.sampleCount,2);assert.equal(result.excluded.unknown_usage,2);assert.equal(result.excluded.different_usage,1);
 const gardenResult=cadastralReference([generic,garden,parcel(6,{usage:'промышленное садоводство'}),parcel(7,{usage:'Для ведения огородничества'})],{...options,usage:'Садоводство'});assert.equal(gardenResult.sampleCount,1);
});
test('identical cadastral duplicates have one weight while contradictory observations are excluded',()=>{
 const same=parcel(1),later=parcel(1,{checkedAt:'2026-11-22T10:00:00Z'}),conflictA=parcel(2),conflictB=parcel(2,{cost:300000});
 const result=cadastralReference([same,later,conflictA,conflictB],options);assert.equal(result.sampleCount,1);assert.equal(result.duplicateCount,2);assert.equal(result.excluded.duplicate_conflict,1);assert.equal(result.samples[0].checkedAt,'2026-11-22T10:00:00Z');
});
test('exact cadastral reference is separate from average and stays visible outside comparable area range',()=>{
 const ref=parcel(900,{area:5000,cost:1250000,usage:'Для ведения личного подсобного хозяйства'}),good=parcel(1);
 const result=cadastralReference([ref,good],{...options,referenceCadastre:'40:04:010802:900',targetAreaM2:1000});
 assert.equal(result.sampleCount,1);assert.equal(result.meanPerSotka,20000);assert.equal(result.referenceParcel.costRub,1250000);assert.equal(result.referenceParcel.costPerSotka,25000);assert.equal(result.referenceParcel.officialTotalAvailable,true);assert.equal(result.referenceParcel.geometry,undefined);assert.equal(result.estimatedTotal,200000);assert.equal(result.excluded.outside_area_range,1);
});
test('foreign source layers, unresolved identities and source conflicts are not used as price evidence',()=>{
 const conflict=parcel(1,{sourceConflicts:['area']}),foreign=parcel(2,{layerId:'36369',categoryId:36369}),identity=parcel(3);identity.attributes.cad_number='40:04:010802:999';
 const result=cadastralReference([conflict,foreign,identity],options);assert.equal(result.sampleCount,0);assert.equal(result.excluded.source_conflict,1);assert.equal(result.excluded.different_layer,1);assert.equal(result.excluded.identity_conflict,1);assert.equal(result.meanPerSotka,null);
});
test('bounded details do not truncate aggregate statistics and unknown observation dates remain unknown',()=>{
 const result=cadastralReference([parcel(1,{checkedAt:null}),parcel(2),parcel(3)],{...options,maxDetails:1});assert.equal(result.sampleCount,3);assert.equal(result.samples.length,1);assert.equal(result.samplesTruncated,true);assert.equal(result.missingSourceDates,1);assert.equal(result.meanPerSotka,20000);
});
