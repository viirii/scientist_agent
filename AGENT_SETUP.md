# Model research loop

The reasoning engine is implemented but **not enabled by default**. The current web remains a deterministic reader until local configuration is completed. Existing runs retain their engine; enabling the model creates a separate research run.

## Enable locally

Add these settings to ignored `.env` (never paste credentials into chat):

```dotenv
REPLAY_AGENT_ENGINE=model
OPENAI_API_KEY=<your API key>
OPENAI_MODEL=gpt-5.6-luna
MONGODB_CORPUS_READ_URI=<dedicated read-only corpus URI>
REPLAY_CORPUS_VERSION=cord19-2020-fulltext-v1
```

Use a dedicated Mongo database user with `read` access to `replay_corpus`, rather than the import user. Restart with `npm start`. Configuration is validated; model mode does not silently fall back to dummy reasoning. API use is paid through the configured OpenAI account. Start with a bounded monthly run and review its quotes before treating findings as useful research. New runs include a separately pinned pre-2020 baseline in January/February. The active expanded release adds March–November literature under monthly gates. Pin the model ID for reproducible comparisons.

Hackathon choice: both arms use GPT-5.6 Luna. The adapter sets reasoning effort to `none` for this model to prioritize short, structured demo responses and avoid consuming the output allowance on internal reasoning. Scientific quality still requires review.

## Cycle contract

Each arm runs three successful cycles per monthly checkpoint:

1. Model chooses keyword search from the goal, current-arm memory, hypotheses and agenda.
2. Gateway searches only the run's frozen corpus at the persisted monthly cutoff. A failed keyword match falls back to an empty query. Model selects at most two of ten eligible candidates.
3. Gateway reads selected papers; up to the first 10,000 UTF-16 characters per paper are supplied, explicitly marked if truncated. Whole papers remain available in the operator viewer. Paragraph-focused retrieval is future work.
4. Model returns structured hypotheses, rationale/confidence, memory notes, next questions, proposed historical evidence checks and optional ranking preference.
5. Server checks schemas, known hypothesis IDs, current-cycle passage handles; the server supplies and verifies exact quote text and UTF-16 offsets, eligible source IDs and fixed-arm policy. All scientific updates apply together after validation; append-only events preserve prior revisions.
6. Successful cycles save immediately. When a later call fails, previously completed cycles survive and the month remains ready to retry. Both arms must complete before the monthly snapshot freezes.

Persistent memory stores cited summaries/lessons and maximum source availability dates. Recent twelve memory notes and hypotheses are provided each cycle; complete history remains in the local file. Automatic memory compaction/relevance selection and Mongo-backed agent state remain pending. Notes are model interpretations, not independently verified facts.

Proposed research requests are **high-level historical evidence checks**, with abstract discriminating outcomes. They remain `pending_historical_resolver`: no experiment is executed, and no biological result or measurement is invented. P4 outcome cards and private scoring remain pending.

## Budgets and recovery

Equal hard ceilings per arm/month: 12 calls, 1,100,000 reserved token units; each call has 80KB context cap, 4,096 output tokens and a 45-second timeout. Each cycle reads at most two papers. UTF-8 input/schema bytes plus conservative instruction overhead/output cap reserve budget before the request; successful API usage is recorded separately. Failed/unknown usage stays conservatively charged. This is a conservative allowance, not exact token billing or a dollar cap.

No automatic retries or unbounded output repair. A crash during a call may require a new paid attempt, but the original reservation persists. Budget exhaustion leaves the run incomplete; it cannot silently advance or bypass the ceiling. Successful cycle updates persist, but external API calls and local state cannot form one atomic transaction. Background jobs, pause/cancel, process leases and precise monetary accounting remain pending.

Fixed arm has an immutable workflow. Recursive arm may propose only `prioritizeRecent` (boolean) with a reason; parent versions are retained and cycle failures restore the previous policy. This is a bounded adaptation mechanism, not evidence that recursion improves scientific performance. Controlled tests cover the contract; real-model behavior requires review.

## Evidence and leakage limits

The model receives only eligible excerpts and its own supplied memory; it receives no evaluator results, other-arm memory, URI, API key or database/shell/browser capability. Exact citations prove quote existence and eligibility, not entailment. Prompt instructions reject document instructions and pretrained future knowledge, but those restrictions do not erase information already in model weights. Scientific interpretation needs P4 grounding review and pretrained-leakage controls.

Adapter follows [official OpenAI structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), uses the Responses endpoint with strict schemas and `store:false`, and rejects incomplete/refused/invalid responses. After API credits were added on October 11, a fresh paired March run completed three cycles per arm with no validation failures. Initial diagnostic runs were preserved separately. Short server-bound paper/source handles avoid long-ID copying errors; models select schema-enforced passage IDs; exact quotations and offsets are derived from the read text. Scientific grounding and a full twelve-month acceptance run remain pending.


## Raw intermediate results and presentation

The saved replay is the source of truth; React presentation is derived from it. `model_request` events preserve the exact context, output schema and output allowance. `raw_model_response` events preserve the full successful HTTP API response before parsing, validation, quote anchoring or hypothesis/memory updates. Incomplete/refused/invalid outputs are retained here but never automatically promoted to research memory. Model credentials and HTTP authorization headers are not stored. These records are saved immediately in the local replay JSON and included in JSON export.

Calls made before this feature retain their accepted structured hypotheses, memory, questions, research requests and audit metadata, but their original raw API payloads cannot be reconstructed. They can still be redisplayed without any model calls. Future presentation changes should read these stored records rather than rerun the agent. Persisted raw output is an audit record, not an authoritative scientific finding. Storage currently remains local, not Mongo-backed.

## Research proposals and historical feedback

New model cycles save high-level proposals alongside hypotheses: motivating citations, why the question matters, competing explanations, evidence needed, discriminating outcomes, priority and limitations. Proposals require scientist review. They are not executable protocols or records of performed experiments.

At the beginning of each subsequent cycle, the resolver checks up to two outstanding requests against `config/historical-observations.json`. Each card must identify a reviewed observation, a frozen corpus version, exact document hash, availability bound, verbatim quote and excerpt-local UTF-16 offset. Keyword `matchAll` retrieves related observations; it is not semantic entailment or an automatic verdict on a hypothesis. The gated corpus reader independently rechecks document availability, hash and quote before returning any observation. Per request, at most two matching cards are read. Resolver attempts have their own audit records and count as historical evidence checks; they do not call a model.

A resolved observation creates a cited memory note whose source event and maximum source date are retained. The next model query receives this arm's recent proposals/results and memory. No matching card returns `no_evidence`: an unresolved coverage gap, never a negative experimental result. A request is checked at most once per cutoff and unresolved requests become eligible for checking after advancing the month. Resolved requests are not checked again. Earlier checkpoints stay immutable. A resolver error rejects the cycle rather than fabricating feedback.

The starter card covers a narrow ACE2 receptor author report from a verified abstract. Its implementation review is explicitly labeled; independent scientist review and broader curated outcome coverage are still needed. Historical observation cards are distinct from the private scientific benchmark, which remains unimplemented. Existing runs retain their original proposals without invented backfilled rationale; new cycles produce the expanded format. Inputs and raw responses remain saved independently of the UI.

## Shared long-term mission and monthly outputs

`src/mission.js` defines the shared mission: understand COVID-19 and human interactions to guide treatment and prevention research, including vaccines. Both arms receive it on every model call; older saved run goals remain as a narrower run focus. New proposals require a `goal_connection`; this is a model rationale, not a validated clinical benefit. Memory notes are month-tagged. Monthly views separate new learning notes from scientist-review action items, including priority, motivating sources, competing explanations and discriminating outcomes. Legacy note months are derived from source-event lineage where possible; frozen outputs and older proposals are not rewritten.

## Complete-paper reading

Eligible full-text versions rank ahead of abstracts. The agent receives the complete extracted abstract, body paragraphs and available figure/table captions; methods, results, discussion and future directions are included wherever the archive extracted them. Images, structured table cells and missing archive content are not reconstructed. The original 10,000-character prefix limit is removed. Citations remain exact UTF-16 offsets into the assembled source text, and the entire source is retained as contiguous exact labeled passages in the persisted synthesis-call input. Reading records include content scope, coverage, character count and section labels.

The existing 80KB total-context budget remains enforced. A second paper that cannot fit is deferred unread; a single oversized paper fails visibly with no truncated scientific update. Section-by-section processing for oversized papers is not yet implemented. Full text retains its independent historical availability gate: the current corpus first unlocks it in May, so March remains abstract-only. Earlier saved readings are not relabeled as complete.

Citation transport now uses `{quote_id, relation}` chosen from a current-cycle enum. The server expands each handle to saved `{version_id, quote_start, quote_end, quote, relation}` citations. Passage text is never paraphrased or normalized; repeated phrases are disambiguated by their passage location. This fixes quotation-copying failures, not scientific entailment. Existing runs remain prompt-pinned; begin a new run for the new citation contract.

## Mongo agent state

The active setup uses `REPLAY_STATE_STORAGE=mongo` and database `scientist_state`. `state_meta` holds the committed inventory/revision and renewable worker lease. `state_parts` holds immutable, hashed run-state generations split below Mongo document limits, including memory, hypotheses, harness lineage and checkpoint snapshots. `state_events` holds individual append-only audit events and raw model calls. The model never receives database credentials.

All saves use majority-committed transactions with revision and lease fencing. Budget reservations persist before API calls; stale workers cannot commit after another worker acquires the expired lease. A global lease serializes mutations across workers; background job scheduling remains a separate milestone. Readers reconstruct a consistent committed generation and verify every part/event hash. Older generations remain retained; cleanup is a future maintenance task.

`node scripts/check-state-store.js` uses a unique disposable test database. `node scripts/migrate-state.js` backs up the local file, refuses a different populated target, migrates, and verifies full source/target hashes. The October 11 migration preserved 11 runs and 1,073 events. Local backup: `data/replay.json.pre-mongo-backup`.

Credential isolation is **pending by user choice**: the current writer is temporarily reused, and a live check showed the current corpus reader can also read other databases. Configure dedicated `MONGODB_STATE_URI` with readWrite only on scientist_state; restrict the corpus reader to read only on replay_corpus; provision a separate evaluator database/user before enabling private benchmark access. No Atlas users/roles were changed automatically.

## Previous-month review

After future model checkpoints, a separate bounded review compares up to four previous-month frozen hypotheses and four proposed studies with up to six newly available abstracts. Reads enforce both the prior lower date bound and current upper cutoff. Non-unresolved verdicts require current-window exact passage citations; proposed studies are checked for whether published evidence addresses the question, never labeled as experiments actually performed by the agent. Reports, inputs, raw responses and token usage are cached in `pair.monthlyReviews`, outside arm research memory and harness context. At most four evaluator calls (including retries) per month; completed reports return from cache. Saved checkpoints support a manual POST `/api/pairs/:id/review?month=3`. This lightweight report is not a private, scientifically adjudicated benchmark.

Long-run storage: audit events are encoded in JSON envelopes, retaining exact string escaping and omitting optional undefined fields consistently with the original local JSON store. Exact event hashes remain verified on load. Prompt context compacts repeated historical citation quotations while full quotes remain in stored memory/audit records. Paper-size previews avoid selecting extracted full text that cannot fit; fallback is explicitly abstract-only, never mislabeled as a full reading. Conservative reservation ceiling is 1.1M byte/output-token units per arm/month, covering the unchanged maximum twelve 80KB calls; reservations are not actual billed tokens.
