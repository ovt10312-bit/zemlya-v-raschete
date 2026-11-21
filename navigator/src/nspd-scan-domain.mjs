import clipping from 'polygon-clipping';
import {boxGeometry,geometryWithin} from './nspd-geometry.mjs';
const multi=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
export function geometryBounds(g){const pts=multi(g).flatMap(p=>p.flat());return {west:Math.min(...pts.map(p=>p[0])),east:Math.max(...pts.map(p=>p[0])),south:Math.min(...pts.map(p=>p[1])),north:Math.max(...pts.map(p=>p[1]))};}
export function geometryArea(g){return multi(g).reduce((sum,p)=>sum+p.reduce((n,r,i)=>{let a=0;const [ox,oy]=r[0];for(let k=0;k<r.length-1;k++)a+=(r[k][0]-ox)*(r[k+1][1]-oy)-(r[k+1][0]-ox)*(r[k][1]-oy);return n+(i?-1:1)*Math.abs(a)/2;},0),0);}
function clippedCell(boundary,scope,id,depth){const coordinates=clipping.intersection(multi(boundary),[boxGeometry(scope).coordinates]);if(!coordinates.length)return null;const geometry={type:'MultiPolygon',coordinates};const area=geometryArea(geometry);return area>1e-15?{id,scope,geometry,area,depth,status:'pending'}:null;}
export function planCells(boundary,cellMetres=500){
 const b=geometryBounds(boundary),lat=(b.south+b.north)/2;
 if(![b.west,b.east,b.south,b.north].every(Number.isFinite)||b.west< -180||b.east>180||b.south< -80||b.north>80)throw Error('Неподдерживаемая область границы.');
 const dx=cellMetres/(111320*Math.cos(lat*Math.PI/180)),dy=cellMetres/111320;
 const cols=Math.ceil((b.east-b.west)/dx),rows=Math.ceil((b.north-b.south)/dy);
 if(cols*rows>2000)throw Error('Территория слишком велика для первого обхода. Выбери отдельный населённый пункт.');
 const cells=[];for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  const c=clippedCell(boundary,{west:b.west+x*dx,east:Math.min(b.east,b.west+(x+1)*dx),south:b.south+y*dy,north:Math.min(b.north,b.south+(y+1)*dy)},`${x}-${y}`,0);if(c)cells.push(c);
 }
 if(!cells.length)throw Error('В границе нет фрагментов для обхода.');return cells;
}
export function splitCell(boundary,cell){const b=cell.scope,x=(b.west+b.east)/2,y=(b.south+b.north)/2;return [{west:b.west,east:x,south:b.south,north:y},{west:x,east:b.east,south:b.south,north:y},{west:b.west,east:x,south:y,north:b.north},{west:x,east:b.east,south:y,north:b.north}].map((b,i)=>clippedCell(boundary,b,cell.id+'.'+i,cell.depth+1)).filter(Boolean);}
export function objectKey(o,cellId,index){const cad=String(o.attributes?.cad_num||'').trim();if(/^\d{2}:\d{2}:\d+:\d+$/.test(cad))return 'cad:'+cad;return o.hasStableSourceId?'id:'+o.id:`unidentified:${cellId}:${index}`;}
export function screenObject(o,boundary){
 const excluded=[],unknown=[];const a=o.attributes||{},ownership=String(a.ownership_type||'').trim(),usage=String(a.permitted_use_established_by_document||'').trim();
 if(o.areaM2==null)unknown.push('Нет площади');else if(o.areaM2<600||o.areaM2>2000)excluded.push('Площадь вне 6–20 соток');
 if(/частн/i.test(ownership))excluded.push('Частная собственность');else if(!/муниципальн|государственн|федеральн|собственность субъекта/i.test(ownership))unknown.push('Государственная или муниципальная собственность не подтверждена');
 if(!usage)unknown.push('Не указан вид использования');
 else if(/полев|сельскохозяйственн.{0,30}производств|гараж|магазин|торгов|газопровод|ясл|детск.{0,8}сад|образован|рекреацион|оздоровительн|общего пользования|промышлен/i.test(usage))excluded.push('Нецелевое назначение');
 else if(/эксплуатаци|обслуживани/i.test(usage)&&/жил.{0,10}дом/i.test(usage))unknown.push('Обслуживание жилого дома: проверить ВРИ, застройку и права');
 else if(!/ижс|индивидуальн.{0,35}жил|приусадеб|садовод/i.test(usage))unknown.push('Соответствие ВРИ целевому использованию требует проверки');
 if(o.sourceConflicts?.length)unknown.push('Противоречивые сведения в ответах источника: '+o.sourceConflicts.join(', '));
 const within=o.geometry?geometryWithin(o.geometry,[boundary]):null;
 if(within===false&&o.coordinateStatus==='declared')excluded.push('Не полностью внутри выбранной границы');else if(within!==true||o.coordinateStatus!=='declared')unknown.push('Вхождение в границу или система координат не подтверждены');
 return {status:excluded.length?'excluded':unknown.length?'unknown':'review',excluded,unknown,within,isCandidate:false,legalAvailability:'unknown'};
}
