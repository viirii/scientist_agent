# Resume context — 2026-10-11

Resumed after offline interval. January–November execution completed.

- Current run: `c52cf13c-c662-47da-90b9-70f806080a2b`. Month 11 checkpoint; all 11 paired checkpoints saved in Mongo `scientist_state`.
- Both arms completed 33 cycles. Fixed: 23 readings, 38 memory notes, 35 proposals. Recursive: 27 readings, 38 memory notes, 32 proposals. Both harnesses remain version 1; no strategy promotion demonstrated.
- March–November retrospective reviews complete; January/February baseline reviews backfilled. Raw model outputs are cached independently of display.
- Mongo state and event hash verification passed after execution. 57 regression tests passed.
- Final cycle recovered after audit payload aliasing: recorder now structuredClone snapshots payloads; Mongo rejected attempted old-event mutation before commit. Prior usage preserved, no budget reset.
- PROJECT_TRACKER.md updated. Results summary: data/audits/through-11-c52cf13c-c662-47da-90b9-70f806080a2b.json; batch log: data/audits/jan-nov-run.log.
- Current run remains pinned to cord19-2020-through-nov-v1 plus coronavirus-pre2020-baseline-v1. December not run.
- Complete corpus importer separately reported frozen: 603,892 versions, 251,983 full-text versions, 9,051,065 virtual chunks. Check manifest and separate boundary audit before switching any new run. Do not silently change this run’s corpus.
- Local app was running at localhost:3000. Frontend saved-run selection persistence verified: November loads and January–November buttons enabled; December disabled. Local service restarted to recover Mongo connection.
- Next: verify UI exposes January–November for this run; review scientific grounding and harness evolution; decide separately how to use complete corpus/December. Dedicated Mongo credential isolation remains deferred by explicit user choice.
- No additional agent execution performed during resume verification. Never print .env credentials.

- Expanded strategy run prepared separately: 785a0b82-98d6-473a-b80b-295c7dbea0ce; runHash af63671971b7e8f76b7abba841599be983fd7bf4ef572b7083f341995e0c0cce. Ready in January, not executed. c52cf13c remains unchanged and backed up under data/backups. Identity audit: data/audits/strategy-run-identity.json.

- Expanded-strategy run LAUNCHED through month 11 by user authorization. Batch log data/audits/recursive-v2-run.log. Check durable status before resuming any driver; never repeat completed cycles or reset budgets. Background driver session 37664, app session 23162.

- Required monthly strategy review now enabled on 785a0b82 mid-run by user request; past checkpoints unchanged. Review decision cached under strategyReviews[month], with raw calls in recursive audit events. Resume driver only after checking status.

- IMPORTANT: 785a0b82 was explicitly restarted from January. Current attempt hash bd4eecb4dc00364849fb3327f03c559466c87a1aa7d86879d8d842879cb5613d; archived previous attempt 46840484-9153-40bb-8f2f-37169c7dc13c. Prior notes about April/May apply to the archive. Restart report data/audits/strategy-run-restart.json.

- CURRENT: restarted 785a0b82 January–November batch FINISHED. Both arms 33 cycles; recursive v13, fixed v1. All 11 checkpoints and literature reviews saved. Driver log confirms completion; no December execution. Next: integrity/strategy-decision audit and scientific comparison with c52cf13c.
