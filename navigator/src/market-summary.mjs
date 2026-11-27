// Asking prices are comparable within a settlement and usage, regardless of quarter.
export function marketOfferSummary(sources,parcel){
 const collected=(sources||[]).flatMap(s=>(s.listings||[]).slice(0,25));
 const eligible=collected.filter(a=>a.settlement===parcel.settlement&&a.usage===parcel.usage);
 return {collected,eligible};
}
