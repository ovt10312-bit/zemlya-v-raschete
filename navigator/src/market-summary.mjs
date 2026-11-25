import {cadastralQuarter,parcelQuarter} from './cadastral-quarter.mjs';
export function marketOfferSummary(sources,parcel){
 const collected=(sources||[]).flatMap(s=>(s.listings||[]).slice(0,25));
 const comparable=collected.filter(a=>a.settlement===parcel.settlement&&a.usage===parcel.usage);
 const quarterRequired=parcel.quarterScopeRequired===true||parcel.origin==='formation',quarter=parcelQuarter(parcel);
 const eligible=comparable.filter(a=>!quarterRequired||!!quarter&&cadastralQuarter(a.quarterCadastre)===quarter);
 return {collected,eligible,quarter,quarterRequired,missingQuarter:comparable.filter(a=>!cadastralQuarter(a.quarterCadastre)).length,differentQuarter:quarter?comparable.filter(a=>cadastralQuarter(a.quarterCadastre)&&cadastralQuarter(a.quarterCadastre)!==quarter).length:0};
}
