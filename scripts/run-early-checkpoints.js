import {writeFile,mkdir} from 'node:fs/promises';
const base='http://localhost:3000';
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(body?.requestKey?{'Idempotency-Key':body.requestKey}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw new Error(v.error||`HTTP ${r.status}`);return v;}
try{const pair=process.argv[2]?await api(`/api/pairs/${process.argv[2]}`):await api('/api/pairs','POST');console.log(JSON.stringify({stage:'created',id:pair.id,corpus:pair.corpusVersion,baseline:pair.baselineCorpusVersion}));
for(let month=pair.month;month<=3;month++){
 const result=await api(`/api/pairs/${pair.id}/step`,'POST',{requestKey:`early-acceptance-${month}`});
 const report={stage:'checkpoint',id:pair.id,month,status:result.status,arms:result.arms.map(a=>({name:a.name,cycles:a.cycles,readings:a.readings.length,memory:a.memory.length,hypotheses:a.hypotheses.length,proposals:a.researchRequests?.length||0,tokens:a.usage.modelTokens,failure:a.events.filter(e=>e.type==='cycle_failed').at(-1)?.payload}))};console.log(JSON.stringify(report));
 if(result.status!=='checkpoint')throw new Error('Early checkpoint incomplete; inspect saved failure before retrying');
 if(month<3)await api(`/api/pairs/${pair.id}/advance`,'POST');
}
await mkdir('data/audits',{recursive:true});await writeFile('data/audits/early-checkpoints.json',JSON.stringify(await api(`/api/pairs/${pair.id}`),null,2));console.log('January–March smoke run complete; scientific grounding remains subject to review.');
}catch(e){console.error(e.message);process.exitCode=1;}
