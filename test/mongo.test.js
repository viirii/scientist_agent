import test from 'node:test';
import assert from 'node:assert/strict';
import { mongoConfig, safeMongoError } from '../src/mongo/config.js';
import { corpusCollections, prepareCorpus, temporalFilter } from '../src/mongo/schema.js';
test('Mongo config rejects missing credentials, placeholders and unrelated databases',()=>{
  assert.throws(()=>mongoConfig({}),/local .env/);
  assert.throws(()=>mongoConfig({MONGODB_URI:'mongodb+srv://user:<password>@example.invalid/'}),/placeholders/);
  assert.throws(()=>mongoConfig({MONGODB_URI:'mongodb://localhost',MONGODB_CORPUS_DB:'admin'}),/replay_corpus/);
  assert.equal(mongoConfig({MONGODB_URI:'mongodb://localhost'}).database,'replay_corpus');
});
test('Mongo diagnostics never repeat connection secrets',()=>{
  const secret='mongodb+srv://user:secret@example.invalid/';
  for(const error of [{message:secret},{message:secret,code:18},{message:secret,code:13},{message:secret,name:'MongoServerSelectionError'}]) {
    const text=safeMongoError(error); assert.ok(!text.includes(secret)); assert.ok(!text.includes('secret'));
  }
});
test('temporal Mongo predicate uses BSON date and refuses invalid cutoffs',()=>{
  const date=new Date('2020-01-31T23:59:59.999Z');
  const query=temporalFilter('v1',date); date.setUTCFullYear(2021);
  assert.equal(query.available_at.$lte.getUTCFullYear(),2020); assert.equal(query.admitted,true);
  assert.throws(()=>temporalFilter('v1',new Date('invalid')));
  assert.throws(()=>temporalFilter('v1','2020-01-31'));
});
test('corpus setup is repeatable and refuses incompatible collections before writing',async()=>{
  const existing=[]; const created=[]; const indexes=[];
  const db={listCollections:()=>({toArray:async()=>existing}),createCollection:async(name,options)=>{existing.push({name,options});created.push(name);},collection:name=>({createIndexes:async specs=>indexes.push({name,specs})})};
  await prepareCorpus(db); await prepareCorpus(db);
  assert.equal(created.length,4); assert.equal(indexes.length,8);
  assert.ok(corpusCollections.papers.validator.$jsonSchema.required.includes('available_at'));
  existing[0].options.validator={};
  await assert.rejects(()=>prepareCorpus(db),/Incompatible/); assert.equal(created.length,4); assert.equal(indexes.length,8);
});
