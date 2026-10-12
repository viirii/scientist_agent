import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
const id=process.argv[2],end=Number(process.argv[3]||11),base='http://localhost:3000';
if(!/^[a-f0-9-]{36}$/.test(id||'')||!Number.isInteger(end)||end<1||end>12)throw new Error('Run ID and valid final month required');
async function api(action='',method='GET',key){return new Promise((resolve,reject)=>{const req=http.request(`${base}/api/pairs/${id}${action}`,{method,headers:key?{'Idempotency-Key':key}:{}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode>=400)reject(new Error(value.error||`HTTP ${res.statusCode}`));else resolve(value);}catch(e){reject(e);}});});req.setTimeout(1800000,()=>req.destroy(new Error('Monthly request timed out; inspect saved progress before resuming')));req.on('error',reject);req.end();});}
try{let pair=await api();console.log(JSON.stringify({stage:'resume',id,month:pair.month,completed:pair.checkpoints.map(c=>c.month),end}));let attempts=0;
while(pair.month<=end){
 if(pair.status==='checkpoint'||pair.status==='complete'){if(pair.month===end||pair.status==='complete')break;pair=await api('/advance','POST');attempts=0;}
 const month=pair.month;pair=await api('/step','POST',`through-${end}-${month}-${attempts}`);
 console.log(JSON.stringify({stage:'month',month,status:pair.status,arms:pair.arms.map(a=>({name:a.name,cycles:a.cycles,readings:a.readings.length,memory:a.memory.length,plans:a.researchRequests?.length||0,harness:a.harness.version,tokens:a.usage.modelTokens,failure:a.events.filter(e=>e.type==='cycle_failed'&&e.month===month).at(-1)?.payload})),reviewComplete:pair.monthlyReviews?.[month]?.complete||false}));
 if(pair.status==='ready'){attempts++;if(attempts>1||pair.arms.some(a=>a.modelBudget?.[month]?.calls>=12&&a.events.filter(e=>e.month===month&&e.type==='cycle_completed').length<3))throw new Error(`Month ${month} incomplete; inspect saved failure before continuing`);}
}
await mkdir('data/audits',{recursive:true});await writeFile(`data/audits/through-${end}-${id}.json`,JSON.stringify({id,completed:pair.checkpoints.map(c=>c.month),arms:pair.arms.map(a=>({name:a.name,cycles:a.cycles,readings:a.readings.length,memory:a.memory.length,plans:a.researchRequests?.length||0,harness:a.harness.version,tokens:a.usage.modelTokens}))},null,2));console.log(`Completed through month ${end}; scientific interpretation still requires review.`);
}catch(e){console.error(e.message);process.exitCode=1;}
