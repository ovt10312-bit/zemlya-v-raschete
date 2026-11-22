// A parcel number identifies its own quarter, never the quarter of another contour.
export function cadastralQuarter(value){const s=String(value||'').replace(/\s+/g,'');if(!/^\d{2}:\d{2}:\d+(?::\d+)?$/.test(s))return null;const parts=s.split(':');if(Number(parts[2])===0)return null;return parts.slice(0,3).join(':');}
export function parcelQuarter(parcel){return cadastralQuarter(parcel.cadastre)||cadastralQuarter(parcel.quarterCadastre);}
export function quarterPriceSummary(records,quarter){
 const code=cadastralQuarter(quarter),rows=code?(records||[]).filter(r=>r.fileComplete===true&&r.classification==='reference'&&cadastralQuarter(r.quarterCadastre)===code):[],values=rows.map(r=>r.perSotka).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b),i=Math.floor(values.length/2);
 return {quarterCadastre:code,referenceRows:values.length,indicativePerSotka:values.length?values.length%2?values[i]:(values[i-1]+values[i])/2:null,records:rows};
}
