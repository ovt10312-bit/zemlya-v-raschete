import {cadastralQuarter} from './cadastral-quarter.mjs';
import {geometryWithin} from './nspd-geometry.mjs';

const CADASTRE=/^\d{2}:\d{2}:\d+:\d+$/;
const COST_DATES=['cost_application_date','cost_determination_date','cost_registration_date','cost_approvement_date'];
const USAGE_NAMES={izh:'ИЖС',lph:'ЛПХ',garden:'Садоводство'};
const norm=value=>String(value??'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const middle=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
function number(value,unit){
 if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
 if(typeof value!=='string')return null;
 let text=value.trim();
 if(unit==='rubles')text=text.replace(/\s*(?:₽|руб(?:\.|лей|ля|ль)?)\s*$/i,'');
 if(unit==='m2')text=text.replace(/\s*(?:м[²2]|кв\.?\s*м\.?)\s*$/i,'');
 if(!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(text))return null;
 const result=Number(text.replace(/[ \u00a0\u202f]/g,'').replace(',','.'));
 return Number.isFinite(result)&&result>0?result:null;
}
function usage(value,category=''){
 const text=norm(value);
 if(!text)return null;
 if(/полев|огороднич|промышлен|производств|питомник|общего пользования|торгов|гараж|эксплуатаци|обслуживани/.test(text))return null;
 if(/(?:^|[^а-я])ижс(?:$|[^а-я])/i.test(text)||/индивидуальн.{0,35}жил.{0,25}(?:строитель|застрой)/.test(text))return 'izh';
 if(/приусадеб/.test(text)&&/(?:личн.{0,20}подсобн|лпх)/.test(text))return 'lph';
 if(/(?:личн.{0,20}подсобн|^лпх$)/.test(text)&&/земли населенных пунктов/.test(norm(category)))return 'lph';
 if(/(?:для|ведения|ведение)\s+(?:любительского\s+)?садоводств|^садоводство$/.test(text)&&!/сельскохозяйствен/.test(text))return 'garden';
 return null;
}
function requestedUsage(value){const text=norm(value);if(text==='ижс')return 'izh';if(text==='лпх'||text==='приусадебное лпх')return 'lph';if(text==='садоводство')return 'garden';return null;}
function identity(object){
 const values=[object.attributes?.cad_num,object.attributes?.cad_number].filter(v=>v!=null&&String(v).trim()!=='').map(v=>String(v).trim());
 if(values.some(v=>!CADASTRE.test(v))||values.some(v=>v!==values[0]))return {issue:'identity_conflict'};
 const cadastre=values[0]||(CADASTRE.test(String(object.name??'').trim())?String(object.name).trim():null);
 if(cadastre)return {cadastre,key:'cad:'+cadastre};
 if(object.hasStableSourceId&&object.id!=null&&String(object.id).trim())return {cadastre:null,key:'id:'+String(object.id)};
 return {issue:'missing_identity'};
}
function area(object){
 const a=object.attributes||{};
 const values=[object.areaM2,a.specified_area,a.area,a.declared_area].map(v=>number(v,'m2')).filter(v=>v!==null);
 if(!values.length)return {value:null,issue:'missing_area'};
 // Unspecified/declared area may legitimately differ from the surveyed area;
 // normalized areaM2 and specified_area must agree when both are present.
 const normalized=number(object.areaM2,'m2'),specified=number(a.specified_area,'m2');
 if(normalized!==null&&specified!==null&&Math.abs(normalized-specified)>1e-7)return {value:null,issue:'area_conflict'};
 return {value:normalized??specified??number(a.area,'m2')??number(a.declared_area,'m2')};
}
function sourceDate(value){return typeof value==='string'&&value.trim()&&Number.isFinite(Date.parse(value))?value:null;}
function boundaryUsable(boundary){
 const polygons=boundary?.type==='Polygon'?[boundary.coordinates]:boundary?.type==='MultiPolygon'?boundary.coordinates:null;
 return Array.isArray(polygons)&&polygons.length>0&&polygons.every(p=>Array.isArray(p)&&p.length>0&&p.every(r=>Array.isArray(r)&&r.length>=4&&r.every(c=>Array.isArray(c)&&c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]))&&geometryWithin(boundary,[boundary])===true;
}
function scalar(object){
 const a=object.attributes||{},id=identity(object),measured=area(object),cost=number(a.cost_value,'rubles');
 const kind=usage(a.permitted_use_established_by_document,a.land_record_category_type);
 return {...id,areaM2:measured.value,areaIssue:measured.issue,costRub:cost,usage:kind,usageText:String(a.permitted_use_established_by_document||''),checkedAt:sourceDate(object.checkedAt)||sourceDate(object.lastSeenAt),sourceURL:typeof object.sourceURL==='string'?object.sourceURL:null,sourceId:object.id==null?null:String(object.id),costDates:Object.fromEntries(COST_DATES.map(k=>[k,sourceDate(a[k])]).filter(([,value])=>value))};
}
function rounded(value){return Number.isFinite(value)?Math.round(value*1e6)/1e6:null;}
/**
 * Saved NSPD EGRN objects -> a cadastral reference in RUB per sotka.
 * boundary must be the actual selected settlement Polygon/MultiPolygon from a
 * trusted scan, NOT a discovery rectangle. This function performs no network IO.
 * Economics adapter: result.economics.cadastrePerSotka; caller preserves any
 * explicit user value. Mean/estimatedTotal are estimates, not official valuation
 * of a newly drawn contour. Rates, coefficients and rent are never supplied.
 */
export function cadastralReference(objects,{boundary,settlement='',region='',usage:usageOption,areaMinM2=600,areaMaxM2=2000,referenceCadastre=null,targetAreaM2=null,sourceScanId=null,maxDetails=50,quarterCadastre=null}={}){
 const selectedUsage=requestedUsage(usageOption);
 if(!selectedUsage)throw Error('Выбери ИЖС, приусадебное ЛПХ или садоводство для кадастрового ориентира.');
 if(!Number.isFinite(areaMinM2)||!Number.isFinite(areaMaxM2)||areaMinM2<=0||areaMaxM2<areaMinM2)throw Error('Некорректный диапазон площади кадастровой выборки.');
 if(!Number.isInteger(maxDetails)||maxDetails<0||maxDetails>500)throw Error('Некорректный лимит сведений кадастровой выборки.');
 const excluded={},samples=[],groups=new Map();let duplicateCount=0,referenceParcel=null;
 const reject=reason=>excluded[reason]=(excluded[reason]||0)+1;
 const scopeUsable=boundaryUsable(boundary);
 for(const object of Array.isArray(objects)?objects:[]){
  if(!object||typeof object!=='object'){reject('invalid_object');continue;}
  if(String(object.layerId)!=='36048'||Number(object.categoryId)!==36368){reject('different_layer');continue;}
  const value=scalar(object);if(quarterCadastre&&cadastralQuarter(value.cadastre)!==cadastralQuarter(quarterCadastre)){reject('different_quarter');continue;}if(value.issue){reject(value.issue);continue;}
  const list=groups.get(value.key)||[];list.push({object,value});groups.set(value.key,list);
 }
 for(const entries of groups.values()){
  duplicateCount+=entries.length-1;
  const assessed=entries.map(({object,value})=>{
   let issue=null;
   if(object.sourceConflicts?.length)issue='source_conflict';
   else if(!scopeUsable)issue='missing_boundary';
   else if(object.coordinateStatus!=='declared'||!object.geometry)issue='unconfirmed_geometry';
   else {const within=geometryWithin(object.geometry,[boundary]);if(within!==true)issue=within===false?'outside_boundary':'invalid_geometry';}
   return {object,value,issue};
  });
  const signatures=new Set(assessed.map(({value,issue})=>JSON.stringify([value.areaM2,value.costRub,value.usage,issue])));
  if(signatures.size>1){reject('duplicate_conflict');continue;}
  // Exact duplicate observations carry only one weight. Latest source check is provenance.
  assessed.sort((a,b)=>(b.value.checkedAt||'').localeCompare(a.value.checkedAt||''));
  const {value,issue}=assessed[0];if(issue){reject(issue);continue;}
  const rate=value.costRub!==null&&value.areaM2!==null?value.costRub/value.areaM2*100:null;
  if(referenceCadastre&&value.cadastre===String(referenceCadastre).trim())referenceParcel={cadastre:value.cadastre,costRub:value.costRub,areaM2:value.areaM2,costPerSotka:rounded(rate),usage:value.usage?USAGE_NAMES[value.usage]:null,checkedAt:value.checkedAt,sourceURL:value.sourceURL,costDates:value.costDates,officialTotalAvailable:value.costRub!==null,notice:'Стоимость существующего участка по сведениям НСПД; не стоимость нового контура.'};
  if(value.areaIssue){reject(value.areaIssue);continue;}
  if(value.costRub===null){reject('missing_cost');continue;}
  if(value.areaM2<areaMinM2||value.areaM2>areaMaxM2){reject('outside_area_range');continue;}
  if(value.usage!==selectedUsage){reject(value.usage?'different_usage':'unknown_usage');continue;}
  if(!Number.isFinite(rate)||rate<=0){reject('invalid_rate');continue;}
  samples.push({cadastre:value.cadastre,sourceId:value.sourceId,costRub:value.costRub,areaM2:value.areaM2,costPerSotka:rate,usage:USAGE_NAMES[value.usage],checkedAt:value.checkedAt,sourceURL:value.sourceURL,costDates:value.costDates});
 }
 const count=samples.length,totalCost=samples.reduce((n,s)=>n+s.costRub,0),totalArea=samples.reduce((n,s)=>n+s.areaM2,0),mean=count?samples.reduce((n,s)=>n+s.costPerSotka,0)/count:null;
 const meanPerSotka=rounded(mean),medianPerSotka=rounded(middle(samples.map(s=>s.costPerSotka))),weightedMeanPerSotka=count?rounded(totalCost/totalArea*100):null;
 const dates=samples.map(s=>s.checkedAt).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));
 return {quarterCadastre:cadastralQuarter(quarterCadastre),status:!scopeUsable||!count?'unavailable':count<3?'insufficient_data':'available',settlement,region,usage:USAGE_NAMES[selectedUsage],unit:'RUB/sotka',areaMinM2,areaMaxM2,source:'НСПД · ЕГРН',sourceScanId,sampleCount:count,duplicateCount,meanPerSotka,medianPerSotka,weightedMeanPerSotka,estimatedTotal:meanPerSotka!==null&&Number.isFinite(targetAreaM2)&&targetAreaM2>0?rounded(meanPerSotka*targetAreaM2/100):null,sourceCheckedAt:{oldest:dates[0]||null,latest:dates.at(-1)||null},missingSourceDates:count-dates.length,referenceParcel,excluded,samples:samples.slice(0,maxDetails).map(s=>({...s,costPerSotka:rounded(s.costPerSotka)})),samplesTruncated:count>maxDetails,economics:{cadastrePerSotka:meanPerSotka},notice:!count?'Нет сопоставимых кадастровых сведений; значение не подставляется.':count<3?'Предварительный ориентир по малой выборке. Среднее за сотку не является официальной стоимостью нового контура.':'Среднее кадастровой стоимости за сотку по сохранённой выборке. Это ориентир, не официальная стоимость нового контура.'};
}
