import clipping from 'polygon-clipping';
import {geometryArea,geometryBounds} from './nspd-scan-domain.mjs';
import {geometryWithin,geometryOverlaps} from './nspd-geometry.mjs';

const multi=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const touches=(a,b)=>a.west<=b.east&&a.east>=b.west&&a.south<=b.north&&a.north>=b.south;
const polygon=coordinates=>({type:'MultiPolygon',coordinates});
export function formationOptions(input={}){
 const minArea=Number(input.minArea??6),maxArea=Number(input.maxArea??20);
 if(!Number.isFinite(minArea)||!Number.isFinite(maxArea)||minArea<6||maxArea>20||minArea>maxArea)throw Error('Выбери диапазон от 6 до 20 соток.');
 const usage=input.usage??'ИЖС';if(!['ИЖС','Приусадебное ЛПХ','Садоводство'].includes(usage))throw Error('Неизвестная цель использования.');
 return {minArea,maxArea,usage};
}
export function prepareFormation(scan,objects){
 if(scan.status!=='completed'||!scan.territory?.geometry)throw Error('Нужен завершённый обход с сохранённой границей.');
 const cells=scan.cells.filter(c=>c.status!=='split');
 if(!cells.length||cells.some(c=>c.status!=='done'||c.sourceStatus!=='available'||c.httpStatus!==200))throw Error('В обходе есть неполученные или неполные фрагменты.');
 if(objects.some(o=>!o.geometry||o.coordinateStatus!=='declared'||o.sourceConflicts?.length))throw Error('Есть неразобранные контуры или противоречия ЕГРН. Сначала уточни исходные сведения.');
 const boundary=scan.territory.geometry;
 // Check actual union coverage: counts and reported percentages alone are insufficient.
 const covered=clipping.union(...cells.map(c=>multi(c.geometry)));
 const missing=clipping.difference(multi(boundary),covered);
 if(missing.length&&geometryArea(polygon(missing))>geometryArea(boundary)*1e-9)throw Error('Геометрия обхода не покрывает всю сохранённую границу.');
 return {boundary,cells,obstacles:objects.map(o=>({geometry:o.geometry,bounds:geometryBounds(o.geometry)}))};
}
export function findFormationInCell(cell,obstacles,options){
 const near=obstacles.filter(o=>touches(cell.scope,o.bounds));
 const remainder=near.length?clipping.difference(multi(cell.geometry),...near.map(o=>multi(o.geometry))):multi(cell.geometry);
 if(!remainder.length)return null;
 const b=geometryBounds(cell.geometry),lat=(b.south+b.north)/2,lng=(b.west+b.east)/2;
 // Local equirectangular metric approximation. This is never a cadastral survey.
 const sy=6371008.8*Math.PI/180,sx=sy*Math.cos(lat*Math.PI/180);
 const toMetres=p=>[(p[0]-lng)*sx,(p[1]-lat)*sy];
 const fromMetres=p=>[p[0]/sx+lng,p[1]/sy+lat];
 const metric=remainder.map(p=>p.map(r=>r.map(toMetres)));
 const sizes=[options.maxArea,...[15,10,8,6].filter(a=>a>options.minArea&&a<options.maxArea),options.minArea].filter((a,i,aAll)=>aAll.indexOf(a)===i);
 const rectangle=(x,y,w,h)=>[[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2],[x-w/2,y-h/2]];
 const fits=ring=>clipping.difference([[ring]],metric).length===0;
 // One sample per completed source fragment; finite sampling is not exhaustive.
 for(const area of sizes)for(const ratio of [1,1.5,2]){
  const width=Math.sqrt(area*100*ratio),height=area*100/width;
  for(const p of metric){
   const bounds=geometryBounds({type:'Polygon',coordinates:p}),step=10;
   if(bounds.east-bounds.west<width||bounds.north-bounds.south<height)continue;
   const points=[[(bounds.west+bounds.east)/2,(bounds.south+bounds.north)/2]];
   for(let y=bounds.south+height/2;y<=bounds.north-height/2;y+=step)for(let x=bounds.west+width/2;x<=bounds.east-width/2;x+=step)points.push([x,y]);
   // Prefer positions near received parcel contours; this does not establish road access.
   const centres=near.map(o=>toMetres([(o.bounds.west+o.bounds.east)/2,(o.bounds.south+o.bounds.north)/2]));
   const distance=pt=>centres.length?Math.min(...centres.map(c=>(c[0]-pt[0])**2+(c[1]-pt[1])**2)):0;
   points.sort((a,b)=>distance(a)-distance(b));
   const sampled=points.length>120?Array.from({length:120},(_,i)=>points[Math.floor(i*(points.length-1)/119)]):points;
   for(const [x,y]of sampled){const ring=rectangle(x,y,width,height);if(!fits(ring))continue;
    const geometry={type:'Polygon',coordinates:[ring.map(fromMetres)]};
    if(geometryWithin(geometry,[cell.geometry])!==true||near.some(o=>geometryOverlaps(geometry,o.geometry)!==false))continue;
    return {geometry,areaM2:area*100,widthMetres:width,heightMetres:height,centre:fromMetres([x,y]),areaMethod:'local-equirectangular-approximation',geometryOrigin:'generated',coordinateStatus:'declared',sourceCRSDeclared:'EPSG:4326',attributes:{},cellId:cell.id,isCandidate:false,formationFeasibility:'geometry_only',legalAvailability:'unknown',rights:'unknown',access:'unknown',regulation:'unknown',withoutAuction:'unconfirmed'};
   }
  }
 }
 return null;
}
export function formationVerdict(proposal){
 const checks=proposal.checks||[];
 const conflicts=checks.filter(c=>c.status==='intersection'&&c.key!=='zoning');
 return {geometry:'Вмещается по сохранённым контурам ЕГРН',formation:conflicts.length?'Есть пересечения — требуется разбор':'Возможность образования юридически не подтверждена',withoutAuction:'Основание и процедура предоставления не подтверждены',conflicts:conflicts.map(c=>c.name),pending:['Государственная/муниципальная принадлежность и полномочия органа','Права, обременения и ранее поступившие заявления','Действующий ПЗЗ: ВРИ, минимальная и максимальная площадь, размеры','Земли общего пользования, красные линии и проект межевания','Подъезд без пересечения чужих участков, вода, лес и специальные режимы','Основание и процедура предоставления физлицу для выбранной цели'],isCandidate:false,legalAvailability:'unknown'};
}

export function formationTriage(proposal){
 const checks=proposal.checks||[],blocking=['buildings','structures','unfinished','schemes','planning','restrictions','processes'];
 const conflicts=checks.filter(c=>blocking.includes(c.key)&&c.status==='intersection');
 if(conflicts.length)return {status:'conflict',label:'Исключён из подбора',tone:'orange',reasons:conflicts.map(c=>c.name||c.key)};
 const required=[...blocking,'zoning'];
 if(required.some(key=>!checks.some(c=>c.key===key&&!c.incomplete&&['sample_only','intersection'].includes(c.status))))return {status:'unverified',label:checks.length?'Проверка неполна':'Не проверено',tone:'neutral',reasons:[]};
 if(!checks.some(c=>c.key==='zoning'&&c.status==='intersection'))return {status:'unverified',label:'Зона не определена',tone:'neutral',reasons:[]};
 return {status:'zone_pending',label:'Нужен регламент зоны',tone:'neutral',reasons:[]};
}
