import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAvitoLandCategory} from '../server/avito-navigation.mjs';
const list=items=>({count:async()=>items.length,nth:i=>items[i]});
test('native categories use published option values and select real estate then land',async()=>{
 const selected=[];let parent=false;
 const select={isVisible:async()=>true,evaluate:async()=>parent?[{label:'Земельные участки',value:'published-land-id'}]:[{label:'Недвижимость',value:'published-property-id'}],selectOption:async value=>{selected.push(value);parent=true}};
 const page={url:()=> 'https://www.avito.ru/',locator:()=>list([select]),getByRole:()=>list([])};
 const r=await chooseAvitoLandCategory(page,{waitMs:0,clock:()=>0});assert.equal(r.method,'native_category_option');assert.deepEqual(selected,['published-property-id','published-land-id']);
});
test('custom category combobox waits for submenu and selects the rendered option',async()=>{
 let now=0,open=false,parent=false;const actions=[];
 const item=action=>({isVisible:async()=>true,click:async()=>action()});
 const page={url:()=> 'https://www.avito.ru/',locator:()=>list([]),getByRole(role,{name}){
  if(role==='combobox'&&name instanceof RegExp&&name.test('Все категории'))return list([item(()=>{open=true;actions.push('category_menu')})]);
  if(role==='menuitem'&&name==='Недвижимость'&&open)return list([item(()=>{parent=true;actions.push('real_estate')})]);
  if(role==='option'&&name==='Земельные участки'&&parent&&now>=600)return list([item(()=>actions.push('land'))]);return list([]);
 }};
 const r=await chooseAvitoLandCategory(page,{waitMs:1000,clock:()=>now,pause:async ms=>{now+=ms}});assert.equal(r.method,'public_category_item');assert.deepEqual(actions,['category_menu','real_estate','land']);assert.equal(now,600);
});
test('hidden native fields are not forced and missing categories fail at a bounded deadline',async()=>{
 let now=0,selected=false;const page={url:()=> 'https://www.avito.ru/',locator:()=>list([{isVisible:async()=>false,selectOption:async()=>{selected=true}}]),getByRole:()=>list([])};
 await assert.rejects(chooseAvitoLandCategory(page,{waitMs:500,clock:()=>now,pause:async ms=>{now+=ms}}),e=>e.stage==='category_control');assert.equal(selected,false);assert.equal(now,500);
});
test('a visible access check stops category navigation before any click',async()=>{
 const page={url:()=> 'https://www.avito.ru/',getByRole:()=>{throw Error('Must not click')}};
 await assert.rejects(chooseAvitoLandCategory(page,{checkAccess:async()=>{throw Object.assign(Error('Visible challenge'),{stage:'access_check'})}}),e=>e.stage==='access_check');
});
test('already open published land category does not toggle its selected category control',async()=>{
 const r=await chooseAvitoLandCategory({url:()=> 'https://www.avito.ru/kondrovo/zemelnye_uchastki',getByRole:()=>{throw Error('No click needed')}});assert.equal(r.method,'published_land_page');
});
