# Project Tracker — Agent PhD

> Internal working document for us and coding agents. Edit this file directly as implementation progresses; keep it alongside SYSTEM_DESIGN.md.

Updated: 2026-10-11 · 19/37 tasks done

Current focus: App/new agent runs are switching to frozen `cord19-2020-through-nov-v1`: 214,388 verified versions / 318,203 virtual chunks, including 823 full-text versions, plus the separately pinned five-abstract pre-2020 baseline. Read-only monthly checks passed: January/February baseline access, March future-full-text denial, June full-text access and denial of December staging records. Full December archive import continues separately with the explicitly authorized local storage-cap exemption. Existing saved runs preserve their original corpus. All 56 regression tests pass; live Mongo transaction, lease, integrity and migration checks also pass. Earlier failed smoke run 9be012f3 is preserved. Passage-based citation selection is now verified by fresh run c52cf13c: January–March completed with zero failures.

Next milestone: Finish and validate the complete import, then connect new runs to it and verify access across all months. Expand baseline full papers and intermediate monthly full-text snapshots. Scientific grounding review, broader historical outcome cards and the private benchmark remain pending.

Status: **Done** = implemented for the named scope; **Partial** = some work remains; **To do** = not implemented; **Deferred** = intentionally postponed.

## Milestones

| Phase | Status | System design |
|---|---|---|
| P0 · Specification and tracking | Done | 1–11 |
| P1 · Local persistent replay | Done | 2, 4, 7, 9 |
| P2 · Corpus and temporal boundary | Partial | 3, 5, 9 |
| P3 · Live agents and bounded recursive harness | Partial | 5–7 |
| P4 · Historical resolver and private evaluation | Partial | 5, 8, 9 |
| P5 · Extensible interface | Partial | 10 |
| P6 · Atlas integration | Partial | 2, 4, 7 |
| P7 · Real-paper demo and release checks | Partial | 8, 9, 11 |

## P0 — Specification and tracking

Status: **Done** · [System design](SYSTEM_DESIGN.md): 1–11

Exit criteria: Implementation-ready design and a maintainable tracker exist in the repository.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P0.1 · System design | Done | SYSTEM_DESIGN.md specifies architecture, schemas, contracts, safeguards, evaluation and build sequence. |
| P0.2 · Internal project tracker | Done | PROJECT_TRACKER.md records phases, tasks, statuses, exit criteria and evidence. It is maintained directly in the repository. |

## P1 — Local persistent replay

Status: **Done** · [System design](SYSTEM_DESIGN.md): 2, 4, 7, 9

Exit criteria: A synthetic paired replay completes twelve months and resumes from local disk without resetting memory.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P1.1 · Local state repositories | Done | FileStore uses atomic replacement; MemoryStore supports tests. Serialized single-process mutations prevent overlapping writes. |
| P1.2 · Separate arm state and persistent memory | Done | Each pair holds independent arm memory, hypothesis records, usage and append-only audit events. |
| P1.3 · Monthly freeze and advance | Done | Both snapshots must exist before advancing. Checkpoint hashes and twelve-month memory preservation are tested. |
| P1.4 · Retry and restart integrity | Done | Tests cover repeated concurrent step keys, restart from disk and failed-save recovery. |

## P2 — Corpus and temporal boundary

Status: **Partial** · [System design](SYSTEM_DESIGN.md): 3, 5, 9

Exit criteria: Curated, hashed document versions with verified availability dates are importable and every read honors their historical cutoff.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P2.1 · Centralized temporal gateway | Done | Fixture and Mongo access are gated. Web search/counts, paper/chunk reads and deterministic reader use the stored run cutoff. Tests reject request-supplied month overrides and future IDs. |
| P2.2 · Version-aware corpus importer | Done | Abstract and full-text versions, hashes, deduplication, frozen/resumable manifests and independent availability dates implemented. Active main corpus: 200 versions / 1,265 chunks; separately frozen baseline: 5 abstracts / 5 chunks. Unsampled importer and virtual chunks implemented; expanded import/freeze validation still running. |
| P2.3 · Date gating and quarantine | Done | Partial publication dates normalize conservatively; invalid dates are excluded/quarantined. Archive text cannot inherit earlier metadata dates. Live March denial and May full-text access verified. Earlier version-date adjudication is tracked separately. |
| P2.4 · Full leakage regression suite | Partial | Tests cover snapshot revisions, partial/invalid dates, CSV quoting, freeze integrity and future Mongo paper/chunk reads. Prompt injection, summary lineage, cross-arm capability and evaluator access tests remain pending. |
| P2.5 · Semantic retrieval | Deferred | Keyword retrieval works for fixtures. Add date-prefiltered vector retrieval after corpus gating is verified. |

| P2.6 · Corpus curation and historical coverage | Partial | Five pre-2020 review abstracts now provide January/February baseline knowledge for new runs. All eleven March–December metadata snapshots scanned; initial/year-end full-text import is underway (152,000 December parses checked). Pending: final audit/freeze and app switch, baseline full papers, intermediate monthly full-text archives, broader curation and structured table cells. |
| P2.7 · Historical version-date verification | Partial | Conservative snapshot/object upper bounds are recorded. Independently verify earlier availability and review uncertain dates before precise discovery/lead-lag claims. |

## P3 — Live agents and bounded recursive harness

Status: **Partial** · [System design](SYSTEM_DESIGN.md): 5–7

Exit criteria: A structured-output model works within immutable policies and equal budget ceilings; recursive changes are validated with eligible history and reversible.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P3.1 · Deterministic fixture agents | Done | Both arms execute three bounded cycles/month. Mongo runs record eligible paper readings with provenance, not invented hypotheses. Recursive policy changes are deterministic demonstrations. |
| P3.2 · TypeScript backend and runtime contracts | Partial | Strict runtime schemas validate query, paper selection, hypotheses, memory, requests and bounded harness proposals; exact UTF-16 quote checks reject unavailable/fabricated citations. Backend TypeScript migration remains pending. |
| P3.3 · Model adapter and bounded tool loop | Partial | OpenAI Responses adapter and bounded query → select → read → synthesize loop implemented. Only current-arm memory and eligible extracted paper text enter prompts; no external tools. Failed/refused/incomplete outputs are rejected and audited. Controlled adapter tests pass; reader/API/model configuration and first live paired March checkpoint verified. Cited research proposals now include rationale, competing explanations, needed evidence, priority, limitations and discriminating outcomes. Historical results enter later-cycle memory/context. Complete extracted-paper reading replaces the old 10,000-character prefix; coverage is recorded, while papers exceeding the 80KB context budget fail visibly. Raw inputs and pre-validation model responses are cached independently of UI. Twelve-month acceptance and scientific grounding review remain pending. |
| P3.4 · Token, time and spend budgets | Partial | Equal ceilings: 3 cycles/arm/month, 12 model calls/month, 2 reads/cycle, 80KB context, 4,096 output tokens, 45s/request and 1,100,000 conservative input-byte/output-token reservation units/month (12 calls remain the ceiling; actual tokens tracked separately). Attempts reserve durably before network calls; actual successful usage logged. Exact dollar pricing/spend limits and month-wide time cap remain pending. |
| P3.5 · Harness validation, promotion and rollback | Partial | Fixed workflow immutable; recursive model can propose only boolean recency preference with reason. Promotions retain parent lineage, apply next cycle, and failures roll back. Schema/eligible-source validation exists; candidate comparison and scientific benefit evaluation remain pending. |
| P3.6 · Background jobs and pause/resume | Partial | Successful model cycles persist independently; retries resume remaining monthly cycles. In-flight call reservations survive restart. HTTP step remains synchronous; background jobs, safe-cycle pause, job leases remain pending; Mongo state mutations now use a renewable global lease with stale-worker fencing. |

## P4 — Historical resolver and private evaluation

Status: **Partial** · [System design](SYSTEM_DESIGN.md): 5, 8, 9

Exit criteria: Curator-backed historical observations and reviewed benchmarks are isolated from agent feedback, with meaningful audited metrics.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P4.1 · Eligible fixture evidence resolver | Done | Only eligible synthetic records resolve. Future/missing evidence returns the same no_evidence response. |
| P4.2 · Curator-authored historical outcome cards | Partial | Reviewed-card resolver verifies corpus, cutoff, source hash and exact quote; saves cited observations and next-cycle feedback. Missing evidence remains a gap, retries occur at later cutoffs, and two requests/cycle are bounded. One abstract-level ACE2 card verified live (February denied / March allowed), labeled implementation review. Broader curation and scientist review remain pending. |
| P4.3 · Fixture checkpoint metrics | Done | Exact-match coverage, Brier score with denominator and citation presence are computed after freezing. These are not scientific grounding metrics. |
| P4.4 · Evaluator process and access isolation | Partial | Scores do not enter agent memory; evaluator still shares a process and fixture module. Add separate credentials, jobs and restricted capabilities. |
| P4.5 · Real benchmark and extended metrics | To do | Freeze reviewed milestones; add entailment, false positives, lead/lag intervals, cost-normalized yield and blind adjudication. |
| P4.6 · Leakage audit and scientific interpretation | To do | Add unsupported future-claim review and optional no-corpus control; review pretrained-model leakage before interpreting apparent lead. |
| P4.7 · Previous-month literature review | Done | Lightweight cached review compares frozen prior hypotheses and outstanding proposals against up to six newly available abstracts; validates exact prior IDs, target counts, date window and passage citations. Separate UI box with expandable evidence; no feedback into research memory. Automatic after future checkpoints and manual backfill for saved ones. Live March comparison passed for both arms (3/2 hypotheses and 4 proposals each). Not the private scientifically adjudicated benchmark. |

## P5 — Extensible interface

Status: **Partial** · [System design](SYSTEM_DESIGN.md): 10

Exit criteria: Typed reusable components support replay review and future graphics with explicit evidence provenance.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P5.1 · React/TypeScript migration | Done | Typed App, API interfaces, agent cards, checkpoint table, audit trail components replace the vanilla UI; Vite builds static assets. |
| P5.2 · Saved runs, checkpoints and JSON export | Done | React supports saved runs, frozen checkpoint selection, JSON export and cutoff-aware Mongo paper browsing. Each arm starts with a two-sentence leading-hypothesis/next-question summary derived from saved state, including frozen checkpoints; no model call required. Agent PhD branding and the recursive-agent tagline distinguish the product from its COVID-19 benchmark. Shared long-term mission, month-specific learning and detailed goal-linked research proposals are displayed. Legacy fixtures are preserved separately; real-paper scores remain unavailable. |
| P5.3 · 96-well component extension point | Done | Reusable 8×12 empty layout supports accessible selection and optional future evidence links. No measurement data is invented. |
| P5.4 · Historical visual data and charts | To do | Map reviewed historical records to graphics; add confidence/metric charts, lineage views and real measurement legends when data exists. |
| P5.5 · Markdown checkpoint export | To do | Full JSON export exists. Add a readable snapshot report with provenance and manifest. |

## P6 — Atlas integration

Status: **Partial** · [System design](SYSTEM_DESIGN.md): 2, 4, 7

Exit criteria: Atlas persists corpus and runs with indexed temporal access, transactions, leases and evaluator credential isolation.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P6.1 · Atlas setup and environment configuration | Done | Local credentials remain in ignored .env. Live mongo:check succeeded; mongo:setup created corpora, papers, chunks and quarantine with validators/indexes on the cluster (2026-10-11). Cluster upgraded to M10; user enabled storage autoscaling and explicitly authorized resuming without the fixed local import cap. |
| P6.2 · Repository adapter, schemas and indexes | Done | Corpus import and gated Mongo retrieval are connected to the web and deterministic reader. Live March flow is verified. Dedicated read-only credentials and live model retrieval verified. New runs pin both main and optional baseline corpus versions; search/read/chunk/count endpoints enforce frozen sources and monthly gates. Baseline connected to local app; expanded staging corpus remains hidden. Mongo state adapter now stores run memory, hypotheses, harness generations, checkpoints and individual audit/raw-response events in scientist_state. Migration verified 11 runs/1,073 events with matching hashes; local backup retained. |
| P6.3 · Transactions, leases and evaluator credentials | Partial | Majority transactions, revision checks and renewable fenced global worker lease implemented. Live checks passed for concurrent exclusion, stale-worker rejection, transaction rollback, immutable events, tamper detection and >16MB Unicode state. Budget reservations participate in atomic state saves before calls. Dedicated state/evaluator credentials and restricted corpus-reader roles remain pending by user choice; current writer reused temporarily and current corpus reader has broad read access. |

## P7 — Real-paper demo and release checks

Status: **Partial** · [System design](SYSTEM_DESIGN.md): 8, 9, 11

Exit criteria: A reviewed historical replay is reproducible and honestly labeled, with mandatory integrity checks and provenance exports.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P7.1 · Twelve-month fixture acceptance run | Done | Automated test verifies 36 cycles/arm, twelve paired snapshots, December completion and persistent memory. |
| P7.2 · Curated corpus acceptance replay | Partial | Expanded-corpus paired January–March technical acceptance passed after passage-citation fix: run c52cf13c, nine cycles per arm, three frozen checkpoints and zero failures. Full-year acceptance, reviewed scientific grounding and demo rehearsal remain pending. |
| P7.3 · Reproducible manifest and demo rehearsal | To do | Export corpus/model/prompt/config hashes, score version and seeds; rehearse live and fixture fallback paths. |

## Decisions and maintenance

- PROJECT_TRACKER.md is the status source of truth. Edit it directly as tasks land. It is an internal project document, not a dashboard feature.
- Update task status, evidence, and the date whenever implementation work lands. A completed task must name its implemented scope and verification; partial tasks must state what remains.
- Use React + TypeScript + Vite for the frontend with the existing Node API. Next.js remains deferred; the replay service and API contracts stay independent of frontend tooling.
- The backend is currently JavaScript. Runtime schemas now validate model outputs; a TypeScript backend migration remains pending.
- User requested Mongo setup before corpus import. Corpus setup requires local credentials; fixture replay still needs no external credentials and remains file-backed.
- Fixture observations, policy promotion, and scores are synthetic. The 96-well component is an empty layout preview with no biological measurements.
- The system design's six-hour plan is a sequencing guide, not elapsed build time or proof of completion. Live-run integrity criteria remain mandatory.

- 2026-10-11: Product named **Agent PhD**; app heading, browser title, startup label and project document titles updated. Historical replay remains the current product mode.

- 2026-10-11: Clarified product positioning: evidence aggregation → understanding → experiment planning toward a long-term goal. COVID-19/2020 is explicitly the current historical benchmark in UI and design docs.

- 2026-10-11: Pre-2020 baseline frozen in Mongo: five foundational review abstracts, available January onward for newly created runs via a separately pinned corpus. Read-only January retrieval verified; older runs retain original evidence. Full baseline papers and broader curation remain pending.

- 2026-10-11: Read-only retrieval diagnostic saved in data/audits/retrieval.json (January/March/June/December). Zero-hit vaccine/receptor queries found relevant papers with topic anchors. Added bounded topic-preserving fallback and actual-date recency ranking; 49 tests pass. January–March live smoke run is next; expanded corpus switch waits for freeze.

- 2026-10-11: Live early smoke run 9be012f3 uses baseline plus the active curated corpus. January and February checkpoints frozen after bounded exact-quotation retries. March is running; rejected quotation outputs remain in raw audit only, with usage counted. This is technical acceptance, not a scientifically adjudicated comparison.

- 2026-10-11: Import stopped at the intentional 7GB guard, not a verified connection failure. Fixed generic error masking so the storage reason is reported directly. Complete staging corpus remains inaccessible; no cluster capacity/billing settings changed.

- 2026-10-11: Early smoke run 9be012f3 froze January/February; fixed arm completed March, recursive arm completed 2/3 March cycles and reached 12-call ceiling after exact-quotation rejections. March remains incomplete, with accepted memory/raw outputs preserved. Improve quote selection before a fresh paid acceptance run; do not reset the budget or relabel this as success. User increased Atlas disk; storage cap adjustment/resume awaits confirmed capacity.

- 2026-10-11: User explicitly approved disabling the 7GB import cap and resuming, including additional Atlas autoscaling storage charges. Local cap disabled via CORPUS_STORAGE_LIMIT_BYTES=0; Atlas settings unchanged. Existing staging corpus remains resumable and inaccessible until freeze.

- 2026-10-11: Agent PhD visual refresh inspired by Lilly: red accents, warm neutrals, editorial typography, rounded controls and more whitespace. User-selected flask favicon bundled locally; asset MIME support added.

- 2026-10-11: Interactive arm workspaces: split knowledge/next-step summary, compact research counts, Findings/Research plan/Papers/Memory tabs, expandable hypotheses and monthly notes. Removed workflow explanation boxes. Display changes use saved data; no agent rerun.

- 2026-10-11: Publishing an independently frozen March–November corpus (`cord19-2020-through-nov-v1`) from completed, date-gated staging records, with source hashes and full destination-record verification. New default switch is pending freeze and read-only checks; December import continues separately.

- 2026-10-11: Earlier release frozen and read-only monthly boundaries audited (data/audits/early-corpus.json). Default configured to March–November expanded release + baseline; no December staging data exposed and no paid agent calls made for this switch.

- 2026-10-11: Quotation reliability fix implemented: dynamic structured-output schema restricts citation selection to current-cycle passage IDs; server derives verbatim text and UTF-16 offsets. Full extracted text remains available as contiguous labeled passages. Regression coverage includes repeated text, Unicode, unavailable IDs, altered sources and full-paper tail citations. All 52 tests pass. Fresh expanded-corpus January–March live acceptance pending; old failed run/budgets remain untouched.

- 2026-10-11: Live passage-citation acceptance passed: run c52cf13c-c662-47da-90b9-70f806080a2b completed January–March, 9 cycles per arm, 3 frozen checkpoints, zero citation/cycle failures. Raw responses, expanded exact citations, memory and plans saved. Neither arm proposed a harness promotion in this run; broader strategy evolution and scientific entailment review remain pending.

- 2026-10-11: P6 state migration verified: 11 runs and 1,073 events, identical source/target canonical hashes, local backup retained. Mongo adapter supports chunked immutable generations, separate raw events, transactions and renewable fenced leases. All 56 regression tests pass plus live Mongo recovery/integrity checks. Dedicated credential isolation deferred explicitly by user.

- 2026-10-11: Local app runtime verified stateStorage=mongo. Migrated January–March checkpoints readable through API; new run cf9df2c7 committed through transactional Mongo store and survived server restart. No model charges for storage verification. P6.2 complete; P6.3 remains partial for dedicated state/evaluator users and restricted corpus-reader permissions, deferred by user.

- 2026-10-11: Added How we did last month review box above each arm summary. Frozen previous-month hypotheses/proposals are compared against a bounded search of newly available abstracts; exact passage citations and target IDs validated. Reports/raw responses cached in pair.monthlyReviews, outside research memory/harness inputs. Automatic after future checkpoints; manual backfill for saved checkpoints. 55 regression tests pass; live March backfill completed for both arms after schema-constrained target/count correction. This is a lightweight model literature review, not the private scientific benchmark.

- 2026-10-11: P4.7 live review completed and cached in Mongo for c52cf13c March: prior 3 fixed/2 recursive hypotheses and 4 carried-forward proposals per arm, six new abstracts each. First rejected incomplete target list preserved in audit; corrected strict schemas require every exact prior target. Reports remain outside arm memory. Existing P4 benchmark/entailment/isolation tasks remain pending.

- 2026-10-11: Connected retrospective review, current knowledge and next steps as one numbered vertical research flow; display-only change using saved state.

- 2026-10-11: User authorized January–November execution for selected run c52cf13c. Existing January–March checkpoints preserved; batch driver now resumes April onward with one bounded retry per month, no budget resets, no advance past incomplete paired checkpoints. Monthly reviews run separately after checkpoint freeze; all results save to Mongo.

- 2026-10-11: Long-run fixes after April exposed two issues. Mongo audit events now use lossless JSON envelopes (optional undefined fields/Unicode stable); three affected paper_read records restored only after reproducing their original hashes, all 1,120 events verified. Model inputs compact repeated old quotation payloads without modifying saved memory. Conservative byte reservation cap aligned to unchanged 12-call/80KB limits, with paired execution_budget_update events and prior usage retained. Full-text byte previews allow budget-fit selection and explicit abstract fallback. 56 regressions plus live Mongo checks pass; April resume underway.
