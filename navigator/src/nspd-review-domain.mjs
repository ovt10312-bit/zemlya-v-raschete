import {geometryOverlaps,geometryWithin} from './nspd-geometry.mjs';
import {NSPD_LAYERS} from './nspd-layers.mjs';
const definitions=[
 ['buildings','36049','Здания'],['structures','36328','Сооружения'],['unfinished','36329','Незавершённое строительство'],
 ['schemes','37294','Схемы расположения'],['planning','36473','Проекты межевания'],
 ['restrictions','37577','ЗОУИТ — общая категория'],['zoning','875838','Территориальные зоны'],
 ['processes','872205','Негативные процессы, включая затопление'],['thirdParty','37298','Отметка слоя «свободные от прав третьих лиц»']
];
export const REVIEW_CATEGORIES=definitions.map(([key,id,name])=>{const l=NSPD_LAYERS.find(l=>l.id===id);return {key,layerId:id,categoryId:l.categoryId,name};});
export function assessReview(parcel,category,response){
 const base={key:category.key,name:category.name,categoryId:category.categoryId,checkedAt:response.checkedAt||null,sourceURL:response.url||null,httpStatus:response.httpStatus??null,sourceStatus:response.status,propertyFields:response.propertyFields||[],optionFields:response.optionFields||[],count:response.count??null,legalAvailability:'unknown',isCandidate:false};
 if(response.status!=='available')return {...base,status:'unknown',detail:response.message||'Источник не предоставил данные.',matches:[],incomplete:true};
 const objects=response.objects||[],incomplete=!!response.possiblyTruncated||(response.count??0)>objects.length;
 let unresolved=false;let unresolvedCount=0;const matches=[];
 for(const object of objects){
  if(!object.geometry||object.coordinateStatus!=='declared'){unresolved=true;unresolvedCount++;continue;}
  const overlap=geometryOverlaps(parcel.geometry,object.geometry);
  if(overlap===null){unresolved=true;unresolvedCount++;continue;}
  if(overlap){
   const namedCad=/^\d{2}:\d{2}:\d+:\d+$/.test(String(object.name||'').trim())?object.name:'';
   const cad=String(object.attributes?.cad_num||object.attributes?.cad_number||namedCad||'').trim();
   const exact=!!cad&&cad===String(parcel.attributes?.cad_num||'').trim();
   const contains=category.key==='thirdParty'?geometryWithin(parcel.geometry,[object.geometry]):null;
   if(category.key==='thirdParty'&&contains===null)unresolved=true;
   matches.push({id:object.id,name:object.name,attributes:object.attributes,coordinateStatus:object.coordinateStatus,sourceCRSDeclared:object.sourceCRSDeclared,sourceCad:cad||null,exactCad:exact,containsParcel:contains,geometryOmitted:JSON.stringify(object.geometry).length>16000,geometry:JSON.stringify(object.geometry).length<=16000?object.geometry:null});
  }
 }
 const uncertain=incomplete||unresolved||parcel.coordinateStatus!=='declared'||(objects.length>0&&!matches.length);
 const preview=matches.slice(0,12);while(preview.length&&JSON.stringify(preview).length>80000)preview.pop();
 const evidence={unresolvedCount,matches:preview,matchIds:matches.map(o=>o.id),matchCount:matches.length,evidenceLimited:preview.length<matches.length,incomplete:uncertain};
 if(category.key==='thirdParty'){
  const flagged=matches.some(o=>o.exactCad||(!o.sourceCad&&o.containsParcel===true));
  if(flagged&&parcel.coordinateStatus==='declared')return {...base,...evidence,status:'source_flag',detail:'Участок сопоставлен с отметкой справочного слоя. Это не выписка о правах и не подтверждение отсутствия аренды или других прав.'};
  return {...base,...evidence,status:uncertain?'unknown':'not_flagged',detail:uncertain?'Ответ неполный или геометрия не подтверждена. Сведения о правах не установлены.':'Сопоставимая отметка в полученной выборке не найдена. Наличие или отсутствие прав третьих лиц не установлено.'};
 }
 if(matches.length&&parcel.coordinateStatus==='declared')return {...base,...evidence,status:'intersection',detail:category.key==='zoning'?'Найдено пересечение с территориальной зоной. Необходимо проверить регламент и допустимые виды использования.':'Найдено геометрическое пересечение с объектом категории. Требуется проверка вида, назначения и режима; это не автоматический запрет.'};
 return {...base,...evidence,status:uncertain?'unknown':'sample_only',detail:uncertain?'Неполные сведения или неподтверждённое пространственное сопоставление. Возможны нераспознанные контуры и касания границ. Проверка остаётся неопределённой.':'В полученной выборке наложения по площади не выявлены. Касания границ отдельно не оценивались; полнота, актуальность и отсутствие объектов или ограничений не подтверждены.'};
}
