import React from 'react';
const money=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
export default function MarketOfferSummary({summary}){
 const {collected,eligible,quarter,quarterRequired,missingQuarter,differentQuarter}=summary;
 if(!collected.length)return null;
 return <div className="notice subtle"><div><b>Объявлений получено: {collected.length}. Подходят для добавления в расчёт: {eligible.length}.</b>
 {quarterRequired&&!quarter&&<p>Кадастровый квартал выбранного контура пока не определён.</p>}
 {quarterRequired&&missingQuarter>0&&<p>У {missingQuarter} объявлений квартал не определён. Их цены показаны ниже; в расчёт контура они пока не включаются.</p>}
 {quarterRequired&&differentQuarter>0&&<p>У {differentQuarter} объявлений указан другой квартал.</p>}
 <details><summary>Посмотреть полученные цены объявлений</summary><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Площадь</th><th>Цена объявления</th><th>Квартал</th></tr></thead><tbody>{collected.map(a=><tr key={a.url||a.id}><td><a href={a.url} target="_blank" rel="noreferrer">{a.source} · {a.sourceOfferId||a.id}</a></td><td>{a.area} сот.</td><td>{money(a.price)}</td><td>{a.quarterCadastre||'Не определён'}</td></tr>)}</tbody></table></div></details></div></div>;
}
