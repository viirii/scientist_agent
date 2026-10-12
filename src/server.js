import { OpenAIModel } from './agent/model.js';
import { HistoricalResolver } from './agent/historical.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReplayService, ReplayError } from './replay.js';
import { FileStore } from './store.js';
import {MongoStore} from './mongo/store.js';
import { AccessError } from './gateway.js';
import { MongoClient } from 'mongodb';
import { loadLocalEnv, mongoConfig, safeMongoError } from './mongo/config.js';
import { MongoEvidenceProvider } from './mongo/provider.js';

export function createServer(service) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      // Local operator app: reject cross-origin mutations and DNS-rebinding hostnames.
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(403, { error: 'Local access only' });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { error: 'Cross-origin mutation denied' });
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/api/runtime' && req.method === 'GET') return send(200,service.runtime());
      if (url.pathname === '/api/pairs' && req.method === 'GET') return send(200, await service.list());
      if (url.pathname === '/api/pairs' && req.method === 'POST') return send(201, await service.create());
      const match = url.pathname.match(/^\/api\/pairs\/([a-f0-9-]+)(?:\/(step|advance|review|evidence|papers|chunks))?$/);
      if (match) {
        const [, id, action] = match;
        if (!action && req.method === 'GET') return send(200, await service.get(id));
        if (action === 'step' && req.method === 'POST') return send(200, await service.step(id, req.headers['idempotency-key']));
        if(action==='review'&&req.method==='POST')return send(200,await service.review(id,Number(url.searchParams.get('month'))));
        if (action === 'advance' && req.method === 'POST') return send(200, await service.advance(id));
        if (action === 'evidence' && req.method === 'GET') return send(200, await service.evidence(id, url.searchParams.get('id')));
        if (action === 'papers' && req.method === 'GET') return send(200, await service.corpus(id,url.searchParams.get('query')||''));
        if (action === 'chunks' && req.method === 'GET') return send(200, await service.chunk(id,url.searchParams.get('id')));
      }
      const assetPath = url.pathname === '/' ? 'index.html' : /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname) ? url.pathname.slice(1) : null;
      if (req.method === 'GET' && assetPath) {
        const type = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'}[extname(assetPath)] || 'application/octet-stream';
        let content;
        try { content = await readFile(new URL(`../dist/${assetPath}`, import.meta.url)); }
        catch(error) { if(error.code==='ENOENT') return send(404,{error:'UI assets unavailable; run npm run build'}); throw error; }
        res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
        return res.end(content);
      }
      send(404, { error: 'Route not found' });
    } catch (error) {
      const status = error instanceof ReplayError ? error.status : error instanceof AccessError ? 404 : 500;
      if (status === 500) console.error('Replay request failed; sensitive connection details omitted.');
      send(status, { error: status === 500 ? 'Unable to persist or process replay state' : error.message });
    }
  });
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  let client,stateClient;
  try {
    loadLocalEnv();
    const source=process.env.REPLAY_DATA_SOURCE || (process.env.MONGODB_URI?'mongo':'fixture');
    if(!['mongo','fixture'].includes(source))throw new ReplayError('REPLAY_DATA_SOURCE must be mongo or fixture');
    let mongoProvider;
    if(source==='mongo') {
      const config=mongoConfig();
      const version=process.env.REPLAY_CORPUS_VERSION || 'cord19-2020-starter-v1';
      client=new MongoClient(process.env.MONGODB_CORPUS_READ_URI?.trim() || config.uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,appName:'scientist-agent-corpus-reader'});
      await client.connect();
      mongoProvider=new MongoEvidenceProvider(client.db(config.database),version,process.env.REPLAY_BASELINE_CORPUS_VERSION?.trim()||undefined);await mongoProvider.ready();
      if(!process.env.MONGODB_CORPUS_READ_URI?.trim())console.log('Local development: corpus reads use the import credential. Configure a separate read URI before enabling model tools.');
    }
    let modelAdapter;
    if(process.env.REPLAY_AGENT_ENGINE==='model'){
      if(!mongoProvider)throw new ReplayError('Model reasoning requires Mongo corpus access.');
      if(!process.env.MONGODB_CORPUS_READ_URI?.trim())throw new ReplayError('Set a dedicated MONGODB_CORPUS_READ_URI before enabling model reasoning.');
      modelAdapter=new OpenAIModel({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL});
    }
    const historicalResolver=new HistoricalResolver(JSON.parse(await readFile(new URL('../config/historical-observations.json',import.meta.url),'utf8')));
    const stateMode=process.env.REPLAY_STATE_STORAGE||'file';
    if(!['mongo','file'].includes(stateMode))throw new ReplayError('Invalid state storage mode');
    let store=new FileStore(resolve(process.env.REPLAY_STATE_PATH || 'data/replay.json'));
    if(stateMode==='mongo'){const uri=process.env.MONGODB_STATE_URI?.trim()||mongoConfig().uri;stateClient=new MongoClient(uri,{serverSelectionTimeoutMS:15000,appName:'agent-phd-state'});await stateClient.connect();const database=process.env.MONGODB_STATE_DB||'scientist_state';if(!/^scientist_state(?:_[a-z0-9_]+)?$/.test(database))throw new ReplayError('Invalid state database');store=new MongoStore(stateClient,stateClient.db(database));await store.ready();}
    const service=new ReplayService(store,{mongoProvider,modelAdapter,historicalResolver,monthlyReviewer:modelAdapter});
    // Preserve legacy fixture runs; create a separate real-corpus run rather than rewriting their history.
    if(mongoProvider && !(await service.list()).some(pair=>pair.mode==='mongo_corpus'&&pair.corpusVersion===mongoProvider.corpusVersion&&pair.baselineCorpusVersion===mongoProvider.baselineCorpusVersion&&pair.agentEngine===service.runtime().agentEngine))await service.create();
    const server=createServer(service);
    server.listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>console.log(`Agent PhD: http://localhost:${server.address().port} (${source} evidence; ${service.runtime().agentEngine})`));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close(async()=>{if(client)await client.close();if(stateClient)await stateClient.close();process.exit(0);});});
  }catch(error){console.error(error instanceof ReplayError?error.message:safeMongoError(error));if(client)await client.close();if(stateClient)await stateClient.close();process.exitCode=1;}
}
