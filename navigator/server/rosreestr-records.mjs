const TAIL=['okato','region_code','district','city','quarter_cad_number','street','realestate_type_code','wall_material_code','year_build','floor','purpose_code','area','period_start_date','deal_price','currency','doc_type'];
export function schemaVersion(headers){if(headers.length!==17||!['number','deals_number'].includes(headers[0])||!TAIL.every((v,i)=>headers[i+1]===v))throw Error('Столбцы официальной таблицы изменились.');return headers[0]==='deals_number'?2:1;}
export function normalizePlace(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/^(?:город|г\.?|деревня|д\.?|село|с\.?|поселок|п\.?|пгт\.?)\s+/,'').replace(/\s+/g,' ').trim();}
export function selectionQuery(input,now=Date.now()){
 const settlement=String(input.settlement||'').trim(),regionCode=String(input.regionCode||'').padStart(2,'0'),usage=input.usage==='Приусадебное ЛПХ'?'ЛПХ':input.usage||'ИЖС';
 if(!settlement||settlement.length>200||(!/^\d{2}$/.test(regionCode)||Number(regionCode)===0)||!['ИЖС','ЛПХ','Садоводство'].includes(usage))throw Error('Нужны населённый пункт, код региона и назначение.');
 const min=Number(input.minArea??6),max=Number(input.maxArea??20);if(!Number.isFinite(min)||!Number.isFinite(max)||min<6||max>20||min>max)throw Error('Площадь должна быть от 6 до 20 соток.');
 const end=new Date(now),start=new Date(now);start.setUTCFullYear(start.getUTCFullYear()-1);
 return {settlement,regionCode,usage,minArea:min,maxArea:max,from:start.toISOString(),to:end.toISOString()};
}
export function classifyRecord(fields,headers,query,file,line){
 if(fields.length!==17)throw Error(`Неверное число полей в строке ${line}.`);
 const row=Object.fromEntries(headers.map((key,i)=>[key,fields[i]]));
 if(String(row.region_code).padStart(2,'0')!==query.regionCode)return {excluded:'other_region'};
 if(normalizePlace(row.city)!==normalizePlace(query.settlement))return {excluded:'other_settlement'};
 if(row.realestate_type_code!=='002001001000')return {excluded:'other_object_type'};
 const code={ИЖС:'142001010000',ЛПХ:'141003000000',Садоводство:'141004000000'}[query.usage];if(row.purpose_code!==code)return {excluded:'other_usage'};
 if(row.doc_type.trim().toUpperCase()!=='ДКП')return {excluded:'other_document'};
 const period=file.period?.match(/^(20\d{2})-Q([1-4])$/);if(!period)throw Error('Не определён период файла.');
 const start=new Date(Date.UTC(+period[1],(+period[2]-1)*3,1)),end=new Date(Date.UTC(+period[1],+period[2]*3,1));
 if(row.period_start_date!==start.toISOString().slice(0,10))return {excluded:'period_mismatch'};
 if(end.getTime()<=Date.parse(query.from)||start.getTime()>Date.parse(query.to))return {excluded:'outside_period'};
 const number=s=>/^\d+(?:[.,]\d+)?$/.test(s.trim())?Number(s.trim().replace(',','.')):NaN;
 const count=number(fields[0]),area=number(row.area),price=number(row.deal_price),issues=[];
 if(!Number.isInteger(count)||count<1)return {excluded:'invalid_count'};
 if(count>1)issues.push('grouped');
 if(!Number.isFinite(area)||area<=0)issues.push('unknown_area');else if(area<query.minArea*100||area>query.maxArea*100)issues.push('outside_area_range');
 if(!Number.isFinite(price)||price<=0)issues.push('unknown_price');
 if(!/^(?:руб|руб\.|рубль|рубли|рублей|RUB|RUR|643)$/i.test(row.currency.trim()))issues.push('other_currency');
 if(start.getTime()<Date.parse(query.from)||end.getTime()>Date.parse(query.to))issues.push('partial_period');
 if(query.usage!=='ИЖС')issues.push('usage_needs_confirmation');
 return {record:{id:`${file.id}:${line}`,fileId:file.id,fileURL:file.url,fileName:file.name,line,period:file.period,version:headers[0]==='deals_number'?2:1,settlement:row.city,regionCode:query.regionCode,district:row.district,quarterCadastre:row.quarter_cad_number,street:row.street,usage:query.usage,purposeCode:row.purpose_code,count,areaM2:Number.isFinite(area)?area:null,priceRub:Number.isFinite(price)?price:null,perSotka:Number.isFinite(price)&&price>0&&area>0?price/area*100:null,periodStart:start.toISOString(),periodEndExclusive:end.toISOString(),dateKind:'quarter_start',issues,classification:issues.length?'review':'reference',priceCaveat:headers[0]==='deals_number'?'Цена могла распределяться между объектами пропорционально кадастровой стоимости.':'Цена земли могла составлять расчётные 20% общей цены договора.',parcelCadastre:null}};
}
// A stateful CSV parser: quoted delimiters/newlines/escaped quotes can cross chunks.
export function createRecordParser(onRecord,{maxRecord=65536}={}){
 let row=[],field='',quoted=false,afterQuote=false,skipLF=false,length=0,first=true;
 function emit(){row.push(field);field='';if(row.some(x=>x.length))onRecord(row);row=[];length=0;}
 function plain(c){if(c==='~'){row.push(field);field='';if(row.length>80)throw Error('Слишком много столбцов.');}else if(c==='\r'||c==='\n'){emit();skipLF=c==='\r';}else if(c==='"'){if(field)throw Error('Кавычка внутри неэкранированного поля.');quoted=true;}else field+=c;}
 return {write(text){for(const c of text){if(first){first=false;if(c==='\uFEFF')continue;}if(skipLF){skipLF=false;if(c==='\n')continue;}if(++length>maxRecord)throw Error('Строка CSV превышает лимит.');if(quoted){if(afterQuote){if(c==='"'){field+='"';afterQuote=false;}else{quoted=false;afterQuote=false;plain(c);}}else if(c==='"')afterQuote=true;else field+=c;}else plain(c);}},end(){if(quoted&&!afterQuote)throw Error('Файл обрывается внутри CSV-поля.');if(field.length||row.length)emit();}};
}
