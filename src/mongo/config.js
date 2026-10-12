import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export function loadLocalEnv() {
  const file = resolve('.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
export function mongoConfig(env = process.env) {
  const uri = env.MONGODB_URI?.trim();
  if (!uri) throw new Error('Save MONGODB_URI in the local .env file first. Never paste it into chat.');
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || /<(?:password|username|db_password)>/i.test(uri)) throw new Error('Replace the connection-string placeholders in .env.');
  const database = env.MONGODB_CORPUS_DB || 'replay_corpus';
  if (!/^replay_corpus(?:_[a-z0-9_]+)?$/.test(database)) throw new Error('Use replay_corpus or a replay_corpus_* database for this setup.');
  return { uri, database };
}
export function safeMongoError(error) {
  // Driver errors can contain connection details. Print only controlled diagnostic text.
  if (error?.code === 18) return 'Mongo authentication failed. Check the database user and URL-encoded password in .env.';
  if (error?.code === 13) return 'Mongo permissions denied. The setup user needs readWrite on the corpus database.';
  if (error?.name === 'MongoServerSelectionError' || ['ENOTFOUND','ECONNREFUSED','ETIMEOUT'].includes(error?.code)) return 'Mongo connection failed. Check that the cluster is ready, your current IP is allowed, and the local URI is correct.';
  return 'Mongo operation failed. Check the local configuration and collection compatibility. Connection details were omitted.';
}
