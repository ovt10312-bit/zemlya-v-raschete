import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarketTable,cometMarketPrompt} from '../src/market-table.mjs';
import {calculate} from '../src/domain.mjs';
const parcel={origin:'formation',area:10,settlement:'Кондрово',region:'Калужская область',usage:'ИЖС'};
const options={date:'2026-11-27'};
test('Comet Markdown table accepts full ruble prices, decimal sotkas and no URLs or quarter',()=>{
 const rows=parseMarketTable('| Цена, ₽ | Площадь, соток |\n|---|---|\n| 550 000 ₽ | 12 сот. |\n| 400000 | 7,8 |',parcel,options);
 assert.equal(rows.length,2);assert.equal(rows[0].price,550000);assert.equal(rows[1].area,7.8);assert.equal(rows[0].url,undefined);assert.equal(rows[0].collectionMethod,'user_supplied_table');
 const result=calculate({...parcel,analogs:rows},new Date('2026-11-27T12:00:00Z'));assert.equal(result.included.length,2);assert.ok(result.price>0);assert.equal(result.profit,null);
});
test('pasting identical tables preserves stable identities; repeated equal prices are not silently deleted',()=>{
 const text='550000; 12\n550000;12';const first=parseMarketTable(text,parcel,options),second=parseMarketTable(text,parcel,options);
 assert.deepEqual(first.map(r=>r.id),second.map(r=>r.id));assert.notEqual(first[0].id,first[1].id);
 const cian=parseMarketTable(text,parcel,{...options,source:'ЦИАН'});assert.notEqual(first[0].id,cian[0].id);
 assert.equal(calculate({...parcel,analogs:[...first,...second]},new Date('2026-11-27T12:00:00Z')).included.length,2);
});
test('table parser rejects ambiguous units, incomplete prices, invalid rows, prose and excess rows atomically',()=>{
 for(const value of ['', '550000;0','-1;12','550000;Infinity','550000;12;extra','1,5 млн;12','550000;1200 м²','Цена, ₽;Площадь, м²\n550000;1200','Результаты поиска\n550000;12',Array(26).fill('550000;12').join('\n')])assert.throws(()=>parseMarketTable(value,parcel,options),value);
 assert.equal(parseMarketTable('Цена, ₽\tПлощадь, соток\n550000\t120',parcel,options)[0].area,120);
});
test('Comet prompt uses selected location and usage, up to25 result cards with no offer navigation or area filter',()=>{
 const prompt=cometMarketPrompt(parcel);for(const part of ['Кондрово','Калужская область','ИЖС','25','не открывай отдельные','Не ограничивай площадь','не добавляй соседние'])assert.ok(prompt.includes(part));assert.ok(!prompt.includes('6–20'));
});
