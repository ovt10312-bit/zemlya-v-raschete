import React,{useEffect,useState} from 'react';
import {MapPin,Loader2,Download} from 'lucide-react';
import {SourceMap,download} from './NspdObjects.jsx';
export default function NspdTerritory({connection,busy,onFind,onChoose}){
 const discovery=connection.boundaryDiscovery,territory=connection.territory;
 const [result,setResult]=useState(null),[picked,setPicked]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;setResult(null);setError('');
  if(!discovery.version)return;
  fetch('/api/nspd/objects?layer=875831').then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось загрузить границы');if(!cancelled)setResult(data)}).catch(e=>{if(!cancelled)setError(e.message)});
  return()=>{cancelled=true};
 },[discovery.version]);
 useEffect(()=>{setPicked(territory?.id||'')},[territory?.id,discovery.version]);
 const choices=discovery.choices||[],choice=choices.find(o=>o.id===picked),ready=result?.snapshot?.version===discovery.version&&!result?.stale&&discovery.observation?.status==='available';
 return <section className="nspd-territory"><div className="nspd-toolbar"><div><h3><MapPin size={17}/> Территория пилота</h3><p className="muted">Сначала получи полигоны населённых пунктов, затем выбери нужный на карте. Прямоугольник окрестностей используется только для получения границ.</p></div><button className="btn primary" disabled={!!busy} onClick={onFind}>{busy==='boundary'?<Loader2 size={16} className="spin"/>:<MapPin size={16}/>}Найти границы около Кондрово</button></div>
 {territory&&<div className={'notice '+(territory.usable?'subtle':'warning')}><p><b>Выбранная граница: {territory.name}</b><br/>{territory.usable?'Следующая загрузка слоёв проверит небольшой фрагмент внутри этого полигона. Весь населённый пункт ещё не обследован.':'Сведения о границе изменились или последняя проверка неуспешна. Обнови границы и выбери полигон заново.'}</p></div>}
 {error&&<div className="notice warning" role="status">{error}</div>}
 {discovery.observation&&<p className="muted">Последний запрос границ: {new Date(discovery.observation.checkedAt).toLocaleString('ru-RU')} · HTTP {discovery.observation.httpStatus??'—'}. {discovery.observation.message}</p>}
 {result?.snapshot&&<>
  {(result.stale||!ready)&&<div className="notice warning">Показан сохранённый снимок. Выбор недоступен до успешного обновления границ.</div>}
  {discovery.partial&&<div className="notice warning">Список границ может быть неполным. Отсутствие нужного населённого пункта в списке не означает отсутствие его границы.</div>}
  {result.objects.length>0?<><SourceMap objects={result.objects} selected={picked} onSelect={setPicked} scope={result.snapshot.scope} queryGeometry={territory?.usable?territory.queryGeometry:null}/><label className="field-label" htmlFor="nspd-boundary-choice">Полигон населённого пункта</label><select id="nspd-boundary-choice" disabled={!!busy} value={picked} onChange={e=>setPicked(e.target.value)}><option value="">Выбери полигон на карте или в списке</option>{choices.map(o=><option key={o.id} value={o.id}>{o.attributes.settlement_name||o.attributes.name||o.name}{o.attributes.brd_nmb?' · '+o.attributes.brd_nmb:''}</option>)}</select>
  {choice&&<p className="muted">ID источника: {choice.id}. {choice.attributes.description||''} Сверь расположение и сведения полигона: название «Кондрово» автоматически не присваивается.</p>}
  <div className="settings-actions"><button className="btn primary" disabled={!!busy||!ready||!choice?.selectable} onClick={()=>onChoose(picked,discovery.version)}>Использовать выбранную границу</button><button className="btn secondary" onClick={()=>download(result,'nspd-boundaries-kondrovo.json')}><Download size={16}/>Скачать границы</button></div>
  {choice&&!choice.selectable&&<p className="muted">Выбор невозможен: не хватает геометрии, указанной источником системы координат или постоянного ID.</p>}</>:<div className="notice warning">В этой области источник не вернул полигоны населённых пунктов. Нельзя считать прямоугольник границей Кондрово. Поиск внутри города пока не подтверждён.</div>}
 </>}
 </section>;
}
