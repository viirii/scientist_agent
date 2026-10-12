# Mongo setup — before corpus import

The application runs on your laptop. Select **Local environment** when Atlas asks where you will connect from. Atlas requires a database user and an allowed client IP; see the [official connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

## 1. Finish the Atlas connection wizard

1. Select **Add My Current IP Address** and wait for the cluster to be ready. Use your current IP rather than an unrestricted network rule.
2. Create a database user, such as `corpus_writer`. This is separate from your Atlas website login. Save its password in your password manager.
3. Give the setup/import user `readWrite` on the specific database `replay_corpus` (Database Access → specific database privileges if necessary). Do not use an account-wide admin role for the app. State and evaluator credentials will be added when those adapters land.
4. Choose **Drivers → Node.js** and copy the supplied `mongodb+srv://...` connection string locally.

If the wizard initially creates a broader role, restrict it to the corpus database under Database Access before using it in the app. Role-management details: [Mongo database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).

## 2. Save the connection locally

Open `.env` in this repository. Set:

```dotenv
MONGODB_URI="<paste the completed Atlas driver connection string locally>"
MONGODB_CORPUS_DB=replay_corpus
```

Replace password placeholders locally. URL-encode special characters in the password portion; the full URI is a secret. Keep it out of chat, screenshots, Git and frontend/Vite variables. `.env` is ignored. `.env.example` documents the non-secret configuration keys.

The scripts load `.env` automatically. They do not print URIs, credentials or raw driver errors. They preserve TLS defaults. Switching the setup credential does not switch replay persistence: the dashboard still uses local files until the state adapter is implemented.

## 3. Verify and initialize

```sh
npm run mongo:check
npm run mongo:setup
npm run mongo:check
```

`mongo:check` pings Mongo and reports corpus collection readiness. `mongo:setup` creates four collections, strict validation rules and indexes. It is repeatable and refuses to modify incompatible existing validators; it does not delete or migrate existing data. If any existing collection conflicts, choose a fresh `replay_corpus_*` database and give the setup user access to that database. Index setup is resumable if a connection drops.

| Collection | Purpose |
|---|---|
| `corpora` | Versioned manifest, hash and staging/frozen status |
| `papers` | Curated paper versions with verified availability dates and content hashes |
| `chunks` | Text excerpts inheriting the paper version and availability date |
| `quarantine` | Excluded sources and review reasons; never available to the agent |

Dates are BSON Dates. Query gates require `corpus_version`, `admitted: true`, and `available_at <= server cutoff`. Import must verify chunk/parent date equality and enforce immutability after freezing; collection schemas alone do not establish provenance or historical version correctness.

## 4. Before real agent access

Create a separate `corpus_reader` with only `read` on `replay_corpus`, save its URI as `MONGODB_CORPUS_READ_URI`, and give it only to the trusted retrieval service. The agent receives tool responses rather than credentials. The reader role cannot enforce per-month gating by itself: the service must apply the cutoff on every read and require a frozen corpus version. The evaluator's future evidence and replay state will use separate databases and credentials.

## Current boundary

This setup prepares **corpus storage only**. CORD-19 abstract import and cutoff-gated real-paper retrieval are implemented. The web and deterministic reader now use Mongo evidence by default when configured. The Atlas state repository, live model, transactions/leases and isolated evaluation remain pending in PROJECT_TRACKER.md. Bootstrap itself does not upload papers.
