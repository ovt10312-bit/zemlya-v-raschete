const number=value=>{
 const raw=String(value).trim().replace(/[\s\u00a0\u202f]/g,'');
 if(!/^\d+(?:[.,]\d+)?$/.test(raw))return null;
 const n=Number(raw.replace(',','.'));return Number.isFinite(n)&&n>0?n:null;
};
const fingerprint=text=>{let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16)};
export function cometMarketPrompt(parcel,source='Авито'){
 return `Найди на ${source} земельные участки в населённом пункте ${parcel.settlement}, ${parcel.region}, с назначением ${parcel.usage}. Просмотри до 25 объявлений прямо в списке: прокручивай выдачу, не открывай отдельные объявления. Не ограничивай площадь и не привязывайся к кадастровому кварталу. Используй только этот населённый пункт, не добавляй соседние. Верни только таблицу с двумя столбцами: «Цена, ₽» и «Площадь, соток». Указывай полную цену участка в рублях, не цену за сотку и не ежемесячный платёж. Ссылки не нужны. Не придумывай недостающие значения. Не включай строки без цены, площади или подтверждённого назначения. Если объявлений меньше 25, покажи найденные; если сайт недоступен, так и сообщи.`;
}
export function parseMarketTable(text,parcel,{source='Авито',date=new Date().toISOString().slice(0,10)}={}){
 if(!['Авито','ЦИАН'].includes(source)||!parcel.settlement||!parcel.usage)throw Error('Укажи источник, населённый пункт и назначение участка.');
 if(typeof text!=='string'||text.length>20000)throw Error('Таблица слишком большая. Допускается до 25 объявлений.');
 const lines=text.trim().split(/\r?\n/).filter(l=>l.trim());let rows=[],header=false;
 for(const line of lines){
  const cells=line.trim().replace(/^\|/,'').replace(/\|$/,'').split(line.includes('|')?'|':line.includes('\t')?'\t':';').map(s=>s.trim());
  if(cells.every(s=>/^:?-{3,}:?$/.test(s)))continue;
  if(!header&&rows.length===0&&cells.length===2&&/^Цена(?:\s*,?\s*(?:₽|руб\.?|рублей))?$/i.test(cells[0])&&/^Площадь\s*,?\s*(?:соток|сотки|сот\.?)$/i.test(cells[1])){header=true;continue;}
  if(cells.length!==2)throw Error('Нужны два столбца: цена в рублях; площадь в сотках. Вставь только таблицу, без пояснений.');
  const price=number(cells[0].replace(/\s*(?:₽|руб\.?|рублей)\s*$/i,'')),area=number(cells[1].replace(/\s*(?:соток|сотки|сот\.?|сотка)\s*$/i,''));
  if(price===null||area===null)throw Error(`Не удалось прочитать строку ${rows.length+1}. Нужны полная цена числом и площадь в сотках, например: 550000; 12.`);
  rows.push({price,area});if(rows.length>25)throw Error('Вставь не больше 25 объявлений.');
 }
 if(!rows.length)throw Error('Вставь таблицу с ценой и площадью хотя бы одного участка.');
 const context=JSON.stringify([source,parcel.region,parcel.settlement,parcel.usage]);
 const occurrences=new Map();
 return rows.map(row=>{const key=JSON.stringify([context,row.price,row.area]);const count=(occurrences.get(key)||0)+1;occurrences.set(key,count);return {...row,id:'market-table-'+fingerprint(key)+'-'+count,source,sourceKind:'asking_price',collectionMethod:'user_supplied_table',verification:'user_confirmed_context',settlement:parcel.settlement,region:parcel.region,usage:parcel.usage,date,dateKind:'user_reported_observation',currency:'RUB'};});
}
