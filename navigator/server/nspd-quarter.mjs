import {createHash} from 'node:crypto';import {geometryWithin} from '../src/nspd-geometry.mjs';import {cadastralQuarter} from '../src/cadastral-quarter.mjs';
// Layer36071/category36381: pynspd's published metadata, not an assumed nearest plot.
export function quarterFromGeometry(geometry,objects,{possiblyTruncated=false}={}){
 if(!geometry||possiblyTruncated)return {quarterCadastre:null,quarterOrigin:'unknown',quarterMessage:'Квартал контура не подтверждён.'};
 const matches=new Set();for(const o of objects||[]){if(o.coordinateStatus!=='declared'||!o.geometry)continue;const raw=[o.attributes?.cad_num,o.attributes?.cad_number].filter(Boolean);if(raw.some(v=>String(v).trim()!==cadastralQuarter(v)))continue;const codes=raw.map(cadastralQuarter);if(!codes.length){if(String(o.name||'').trim()!==cadastralQuarter(o.name))continue;codes.push(cadastralQuarter(o.name));}if(codes.some(q=>!q)||new Set(codes).size!==1)continue;if(geometryWithin(geometry,[o.geometry])===true)matches.add(codes[0]);}
 return matches.size===1?{quarterCadastre:[...matches][0],quarterOrigin:'nspd_geometry',quarterMessage:'Квартал подтверждён вхождением контура в границу НСПД.'}:{quarterCadastre:null,quarterOrigin:'unknown',quarterMessage:matches.size>1?'Источник вернул неоднозначные границы кварталов.':'Квартал контура не подтверждён. Выбери его явно для расчёта.'};
}
export function createQuarterResolver({db,query,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS nspd_quarter_assignments(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');const locks=new Set();
 async function resolve(geometry){if(!geometry)return {quarterCadastre:null,quarterOrigin:'unknown'};const key=createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),row=db.prepare('SELECT payload FROM nspd_quarter_assignments WHERE id=?').get(key),old=row?JSON.parse(row.payload):null;
 if(old&&(old.quarterCadastre||clock()-Date.parse(old.quarterCheckedAt)<30000||clock()<(old.retryAt||0)))return old;
 if(locks.has(key))return {quarterCadastre:null,quarterOrigin:'unknown',quarterMessage:'Определяем квартал.'};locks.add(key);
 try{const r=await query(geometry),value={...(r.status==='available'?quarterFromGeometry(geometry,r.objects,{possiblyTruncated:r.possiblyTruncated}):{quarterCadastre:null,quarterOrigin:'unknown',quarterMessage:'НСПД не подтвердил квартал. Выбери квартал явно.'}),quarterCheckedAt:new Date(clock()).toISOString(),quarterSourceURL:r.url||null};if(r.status==='limited'){const sec=Number(r.retryAfter),date=Date.parse(r.retryAfter||'');value.retryAt=Math.max(clock()+30000,sec>0?clock()+sec*1000:Number.isFinite(date)?date:clock()+60000)}db.prepare('INSERT INTO nspd_quarter_assignments VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(value));return value;}finally{locks.delete(key)}
 }
 function peek(geometry){const key=createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),row=db.prepare('SELECT payload FROM nspd_quarter_assignments WHERE id=?').get(key);return row?JSON.parse(row.payload):null;}
 return {resolve,peek};
}
