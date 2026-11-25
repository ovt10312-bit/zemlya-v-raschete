export function isIPRestriction(text){return /доступ\s+(?:ограничен|запрещ[её]н)[^\n]{0,120}\bip\b|доступ[^\n]{0,80}\bip\b[^\n]{0,80}(?:огранич|заблокир|запрещ)/i.test(String(text||''));}
export function isAvitoIPRestricted(source){return source?.source==='Авито'&&(source.reason==='ip_restricted'||source.stage==='ip_restricted'||isIPRestriction(source.accessEvidence?.title||source.uiDiagnostics?.title));}
export function describeMarketAccess(source){
 if(!isAvitoIPRestricted(source))return source;
 return {...source,status:'denied',stage:'ip_restricted',reason:'ip_restricted',connected:false,message:'Авито ограничил доступ: проблема с IP. Цены Авито не получены. ЦИАН можно обновлять отдельно.'};
}
