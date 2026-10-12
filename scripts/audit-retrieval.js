import {mkdir,writeFile} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {loadLocalEnv,mongoConfig,safeMongoError} from '../src/mongo/config.js';
import {MongoEvidenceProvider} from '../src/mongo/provider.js';
const cases=[
 {question:'What was known about coronavirus interactions with human hosts?',query:'coronavirus host interaction',anchor:'coronavirus'},
 {question:'What evidence addresses coronavirus immune responses?',query:'coronavirus immune response',anchor:'immune'},
 {question:'What had prior vaccine research learned?',query:'coronavirus vaccine prevention',anchor:'vaccine'},
 {question:'What evidence addresses receptor use?',query:'coronavirus receptor entry',anchor:'receptor'},
];
let client;try{loadLocalEnv();const c=mongoConfig();client=new MongoClient(process.env.MONGODB_CORPUS_READ_URI,{serverSelectionTimeoutMS:15000});await client.connect();const p=new MongoEvidenceProvider(client.db(c.database),process.argv[2]||process.env.REPLAY_CORPUS_VERSION,process.env.REPLAY_BASELINE_CORPUS_VERSION);await p.ready();const results=[];
for(const month of [1,3,6,12])for(const sample of cases){const pair={corpusVersion:p.corpusVersion,baselineCorpusVersion:p.baselineCorpusVersion,month};const strict=await p.search(pair,sample.query);const broad=await p.search(pair,sample.anchor);const cutoff=new Date(Date.UTC(2020,month+0,1)-1);for(const paper of [...strict,...broad])if(new Date(paper.availableAt)>cutoff)throw new Error('Future evidence returned');results.push({month,...sample,strictCount:strict.length,anchorCount:broad.length,strict:strict.map(({id,title,contentScope,availableAt})=>({id,title,contentScope,availableAt})),anchor:broad.map(({id,title,contentScope,availableAt})=>({id,title,contentScope,availableAt}))});}
const report={corpusVersion:p.corpusVersion,baselineCorpusVersion:p.baselineCorpusVersion,generatedAt:new Date().toISOString(),scope:'Retrieval coverage diagnostic, not scientific relevance or entailment evaluation. Read-only; no model calls.',results};await mkdir('data/audits',{recursive:true});await writeFile('data/audits/retrieval.json',JSON.stringify(report,null,2));console.log(JSON.stringify({corpus:p.corpusVersion,results:results.map(({month,query,strictCount,anchorCount})=>({month,query,strictCount,anchorCount}))},null,2));
}catch(e){console.error(e.message==='Future evidence returned'?e.message:safeMongoError(e));process.exitCode=1;}finally{await client?.close();}
