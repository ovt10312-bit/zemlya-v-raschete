import React,{useState} from 'react';
export default function RosreestrReferences({parcel,onUse}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 async function load(){setError('');try{const r=await fetch('/api/rosreestr/selection'),d=await r.json();if(!r.ok)throw Error(d.error);setData(d)}catch(e){setError(e.message)}}
 const codes={'Калужская область':'40','Тульская область':'71','Ленинградская область':'47','Свердловская область':'66','Тюменская область':'72','Челябинская область':'74','Тверская область':'69','Владимирская область':'33','Республика Башкортостан':'02'};
 const same=data?.job?.query?.settlement?.trim().toLowerCase()===parcel.settlement?.trim().toLowerCase()&&data.job.query.regionCode===codes[parcel.region]&&data.job.query.usage===parcel.usage;
 const rows=same&&data.job.status==='completed'?(data.records||[]).filter(r=>r.fileComplete&&r.classification==='reference'):[];
 return <div className="panel"><h3>Квартальные сведения Росреестра</h3><p>Могут содержать распределённую цену договора. Их можно использовать отдельным предварительным ориентиром; они не увеличивают число подтверждённых индивидуальных сделок.</p><button className="btn secondary" onClick={load}>Проверить сохранённую выборку</button>{error&&<p>{error}</p>}{data&&<p>{rows.length?`Доступно ориентиров: ${rows.length}.`:'Завершённой сопоставимой выборки пока нет. Запусти получение записей за год на главном экране.'}</p>}{rows.length>0&&<button className="btn secondary" onClick={()=>onUse(rows.slice(0,100).map(r=>({...r,source:'Росреестр · квартальные сведения',sourceKind:'quarterly_reference',price:r.priceRub,area:r.areaM2/100,date:r.periodStart.slice(0,10),url:r.fileURL+'#row='+r.line})))}>Добавить до 100 квартальных цен как ориентир</button>}</div>;
}
