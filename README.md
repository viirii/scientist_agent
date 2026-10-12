# Agent PhD

Agent PhD supercharges scientific research by aggregating evidence, building understanding, and planning experiments toward a long-term research goal. Persistent agents connect what is already known with what to investigate next.

The current implementation benchmarks that workflow against COVID-19 research through 2020, a familiar historical example. Its twelve monthly checkpoints compare fixed and recursive harnesses; they describe this benchmark, rather than the overall product. See [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

## Run locally

Requires Node.js 22.18+ and npm. Install dependencies once. Fixture mode needs no external credentials; Mongo mode uses the local .env connection. A model API key is required for model reasoning; fixture/reader modes need none.

```sh
npm install
npm start
```

Open **http://localhost:3000**. Create a paired replay, run January, inspect the frozen states, and unlock February. Repeat through December. Refresh or restart the server to resume. Use Export JSON to download the full run and frozen hashes.

```sh
npm test
npm run check
```

`PORT` defaults to `3000`. `REPLAY_STATE_STORAGE=mongo` stores runs, memory, harnesses, checkpoints and events in `scientist_state`. File mode remains available via `REPLAY_STATE_STORAGE=file`; `REPLAY_STATE_PATH` defaults to `data/replay.json`. Local data is ignored by Git. The server binds only to `127.0.0.1`; this is a local operator application, not a hosted multi-user service.

`npm start` type-checks and builds the React dashboard, then serves it with the Node API. For frontend development, keep the API running and use `npm run dev` in a second terminal; the Vite view is at http://localhost:5173 and proxies API requests to port 3000.

## Project tracker

[PROJECT_TRACKER.md](PROJECT_TRACKER.md) is our internal working document alongside SYSTEM_DESIGN.md. It lists phases, task statuses, exit criteria, evidence and remaining work.

Edit PROJECT_TRACKER.md directly whenever a task lands. Distinguish fixture completion from live-research completion. This tracker is not part of the product interface.

## Visual components

The React/TypeScript UI lives in `web/`. Reusable components include `ArmCard`, `CheckpointTable`, `AuditTrail`, and `WellPlate`. The plate is an interactive, keyboard-accessible 8×12 layout preview with no measurements assigned. `WellPlate` accepts optional typed well labels and evidence IDs for future curated visual data. Do not interpret empty wells as historical experiment results.

## What works now

- File-backed atomic state persistence with serialized mutations and safe retry keys.
- A centralized temporal gateway; direct reads, search, citations, and evidence resolution use the same cutoff.
- Three deterministic cycles per arm/month, separate arm memory, audited hypothesis revisions, and versioned harness promotion.
- Two immutable snapshots before each advance, twelve checkpoints, private evaluation output, and JSON exports.
- Dashboard with saved runs, confidence, provenance, monthly metrics, and audit events.
- Automated temporal-boundary, persistence, concurrency, policy, and HTTP tests.

## Data sources and current agent scope

When MONGODB_URI is set, new runs use the frozen CORD-19 Mongo corpus by default. Startup creates a separate Mongo run if none exists; older fixture runs are preserved. Set REPLAY_DATA_SOURCE=fixture to explicitly use synthetic data, or REPLAY_CORPUS_VERSION to choose another frozen corpus. A failed Mongo connection does not silently switch to fixtures.

Mongo supplies dated literature. Model mode produces cited hypotheses, research plans and persistent memory; reader mode is deterministic. Agent state now uses Mongo when REPLAY_STATE_STORAGE=mongo. Historical scientific benchmark scores remain pending.

In fixture mode, all documents, claims, and outcomes are synthetic software fixtures. The agent responses are deterministic logic, not LLM outputs. The recursive policy change demonstrates the promotion path; it is not evidence of learning or improved research performance. Metrics use exact fixture IDs and labels. No CORD-19 papers are ingested, and no scientific observations or wet-lab protocols are generated.

The evaluator reads the synthetic benchmark after snapshots are created. Scores are stored separately from the memory passed to each cycle. In this local MVP these modules share a process; true evaluator credential/process isolation remains a live-run requirement. Both policies get the same eligible sources and cycle ceilings. Token usage is zero.

## Next implementation slices

1. Add curated version-aware corpus import with verified availability dates and quarantine records.
2. Introduce TypeScript/schema validation and a structured-output model adapter with bounded tools and token accounting.
3. Replace FileStore with an Atlas repository using transactions, indexes, leases, and independent corpus/state/evaluator credentials. Keep MemoryStore for tests.
4. Add independent evaluator execution, curator-authored outcome cards, benchmark review, pause/resume jobs, and harness candidate validation/rollback.
5. Run a curated real-paper replay and review citation entailment and pretrained-model leakage before making performance claims.

The frontend now uses React, TypeScript and Vite; the backend remains JavaScript with file-backed persistence. Next.js, runtime schemas, Atlas and live model integration remain pending or deferred as recorded in the tracker. This does not yet implement all of the system design.

## Mongo corpus setup

Follow [MONGO_SETUP.md](MONGO_SETUP.md). Choose Local environment in Atlas, save the URI only in local `.env`, then run `npm run mongo:check` and `npm run mongo:setup`. This prepares dated corpus collections; replay state still uses files. Curated import is the next slice.

## CORD-19 starter corpus

[CORPUS_IMPORT.md](CORPUS_IMPORT.md) documents the abstract and full-text importers, curation configuration, frozen manifest, quarantine, and historical timing limits. Use `npm run corpus:import -- --dry-run`, then `--write` to persist, and `npm run corpus:inspect` to audit temporal access. New Mongo runs use real papers in the dashboard and deterministic reader. A live research model and scientific benchmark remain pending.

## Mongo web access

The server loads local .env automatically, prefers MONGODB_CORPUS_READ_URI when set, and otherwise uses MONGODB_URI only for development reads. All corpus methods issue read queries; credentials never go to the browser. Configure a dedicated read-only user before enabling model tools. The local UI exposes eligible papers under each run, binds every read to that run’s cutoff, and reports scientific evaluation as unconfigured.

## Research reasoning (P3)

A model-directed, cited research loop is now available as an opt-in engine. See [AGENT_SETUP.md](AGENT_SETUP.md) for local configuration, contracts, budgets, recovery and current limitations. It adds persistent hypothesis revisions, memory notes, next questions and high-level historical evidence requests. Fixed and recursive arms remain isolated; recursive changes are restricted to ranking preference. Real-model acceptance and P4 historical resolution/evaluation are still pending. Default reader runs remain preserved.
