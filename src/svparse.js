// Minimal parser for WoW SavedVariables (Lua table literals) -> JS objects.
function parseSV(src){
  let i=0; const n=src.length; const out={};
  const ws=()=>{ for(;;){ while(i<n && /\s/.test(src[i])) i++; if(src.startsWith('--',i)){ while(i<n && src[i]!=='\n') i++; } else break; } };
  const str=()=>{ const q=src[i++]; let s=''; while(i<n && src[i]!==q){ if(src[i]==='\\'){ i++; const c=src[i++]; s+= c==='n'?'\n':c==='t'?'\t':c==='r'?'\r':(/\d/.test(c)? (()=>{let d=c; while(/\d/.test(src[i])&&d.length<3) d+=src[i++]; return String.fromCharCode(+d);})() : c); } else s+=src[i++]; } i++; return s; };
  const num=()=>{ const m=/^-?(0x[0-9a-fA-F]+|\d*\.?\d+(e[+-]?\d+)?|inf|nan)/i.exec(src.slice(i,i+40)); i+=m[0].length; return Number(m[0]); };
  const val=()=>{ ws(); const c=src[i];
    if(c==='{') return table(); if(c==='"'||c==="'") return str();
    if(src.startsWith('true',i)){i+=4;return true;} if(src.startsWith('false',i)){i+=5;return false;} if(src.startsWith('nil',i)){i+=3;return null;}
    return num(); };
  const table=()=>{ i++; const obj={}; let arr=[]; let isArr=true; let idx=1;
    for(;;){ ws(); if(src[i]==='}'){i++;break;}
      let key;
      if(src[i]==='['){ i++; ws(); key = (src[i]==='"'||src[i]==="'")? str() : num(); ws(); i++; ws(); i++; /* ] = */ }
      else if(/[A-Za-z_]/.test(src[i]) && /^[A-Za-z_]\w*\s*=/.test(src.slice(i,i+80))){ const m=/^([A-Za-z_]\w*)\s*=/.exec(src.slice(i)); key=m[1]; i+=m[0].length; }
      const v=val(); if(key===undefined){ key=idx++; }
      if(typeof key!=='number') isArr=false; obj[key]=v;
      ws(); if(src[i]===','||src[i]===';') i++;
    }
    const ks=Object.keys(obj); if(isArr && ks.length && ks.every((k,j)=>+k===j+1)) return ks.map(k=>obj[k]);
    return obj; };
  while(i<n){ ws(); if(i>=n) break; const m=/^([A-Za-z_]\w*)\s*=/.exec(src.slice(i)); if(!m) break; i+=m[0].length; out[m[1]]=val(); }
  return out;
}
module.exports={parseSV};
if(require.main===module){ const fs=require('fs'); const d=parseSV(fs.readFileSync(process.argv[2],'utf8')); const db=d.PrincessPosseDB;
  console.log(Object.keys(db).map(k=>k+':'+(typeof db[k]==='object'&&db[k]?Object.keys(db[k]).length:db[k])).join('\n')); }
