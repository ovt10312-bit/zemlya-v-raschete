import React from 'react';
const money=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
export default function MarketOfferSummary({summary}){
 const {collected,eligible}=summary;
 if(!collected.length)return null;
 return <div className="notice subtle"><div><b>Объявлений получено: {collected.length}. Подходят для добавления в расчёт: {eligible.length}.</b>
 <p>Сравниваем объявления по населённому пункту и назначению участка. Кадастровый квартал не требуется.</p>
 <details><summary>Посмотреть полученные цены объявлений</summary><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Площадь</th><th>Цена объявления</th></tr></thead><tbody>{collected.map(a=><tr key={a.url||a.id}><td><a href={a.url} target="_blank" rel="noreferrer">{a.source} · {a.sourceOfferId||a.id}</a></td><td>{a.area} сот.</td><td>{money(a.price)}</td></tr>)}</tbody></table></div></details></div></div>;
}
