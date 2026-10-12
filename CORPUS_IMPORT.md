# Curated CORD-19 import

## Current starter corpus

`cord19-2020-starter-v1` contains **168 paper versions**, **331 abstract chunks**, and **60 quarantined source records**. It is a reproducible, automated topic-filtered starter, not an expert-reviewed corpus or a full CORD-19 mirror. Selection favors coronavirus literature about host response, immunity, antibodies, receptors, vaccines and transmission. It caps each publication-month bucket at eight candidates per source snapshot, plus twenty background candidates.

Sources are AI2's initial snapshot and the year-end 2020 snapshot. The parser scanned 29,500 and 400,119 metadata rows respectively. Only the bounded selection is written to Mongo; large CSV downloads stay in ignored `data/cord19/`.

Sources: [CORD-19 documentation](https://github.com/allenai/cord19) and [historical releases](https://ai2-semanticscholar-cord-19.s3-us-west-2.amazonaws.com/historical_releases.html). CORD-19's publication metadata can be inaccurate and the same identifier can appear on multiple rows. The importer preserves source-row hashes and gives different title/abstract content its own version ID rather than merging it into an older version.

## Historical boundary

The default policy is **snapshot_upper_bound**. An abstract's admitted timestamp is the later of its conservative publication-date bound and the historical source object's observation timestamp. Identical title/abstract content appearing in multiple snapshots can use the earliest proven snapshot bound; changed content cannot inherit an older version's timestamp.

The initial release is labeled 2020-03-13, but its metadata object's LastModified timestamp is 2020-03-16. The manifest conservatively uses March 16. Year-end-only abstracts use December 31. No January or February text-version evidence is admitted. Monthly publication coverage is not the same as monthly agent access coverage.

Partial publication dates use month/year end. Invalid or missing publication dates, missing text, and post-2020 publication dates go to the bounded quarantine sample. This collection is separate from admitted `papers` and `chunks`. Ordinary off-topic records and candidates beyond the selection cap are excluded, not uploaded to quarantine. Selection statistics describe all scanned rows; quarantine is a review sample, not a complete inventory of excluded records.

Snapshot bounds are not first-publication or discovery dates and are excluded from precise timing claims. To support the intended January–December research replay, add intermediate historical snapshots and individually verified pre-March versions. Do not unlock December abstracts early simply because the metadata says a paper was published in January. Expert date adjudication and additional snapshots remain pending.

## Commands

```sh
# Build the selection and local manifest without Mongo writes
npm run corpus:import -- --dry-run

# Import with the local .env credential; validate inventories and freeze
npm run corpus:import -- --write

# Audit monthly access counts and denied future paper/chunk IDs
npm run corpus:inspect
```

Configuration: `curation/cord19-starter.json`. Local manifest: `data/cord19/cord19-2020-starter-v1.manifest.json`. The manifest records source URLs, observation evidence, full CSV SHA-256 hashes, selection policy, version/chunk hashes, quarantine reasons and limitations. The Mongo `corpora` record retains the same manifest and hash.

For a different selection, edit a copy of the configuration and assign a new `corpus_version`, then pass its path to the import command. Never reuse a frozen version ID for changed inputs. Expected metadata paths and official URLs are listed in the configuration. Download those files from AI2 when reproducing on another machine; the repository does not redistribute abstracts or the full CSVs.

## Write and read contracts

Import creates a staging manifest, upserts records without overwriting existing documents, compares stored inventories and content hashes with the plan, and only then freezes the corpus. A failed write remains staging and cannot be read through `MongoCorpusReader`; rerun the same plan to resume. Repeated frozen imports verify contents and return `already_frozen`. A changed manifest or tampered record fails rather than being silently replaced.

Corpus freeze is an application invariant: a privileged writer can still alter data directly in Mongo. Keep the import credential separate from a future read-only retrieval credential. Database transactions and stronger permission enforcement remain part of the Atlas integration phase.

`MongoCorpusReader` is constructed with the server's corpus version and cutoff. Search, direct paper reads, chunk reads and counts enforce the date predicate and require a frozen corpus. Chunk reads also verify that their parent paper has the same availability timestamp. Its inspection script is an operator audit; new Mongo replay runs and the web paper browser use this reader. The model loop reads eligible papers and persists cited hypotheses, research proposals, historical feedback and raw model responses.

Abstract chunks use UTF-16 character offsets into the stored, trimmed abstract text, with no overlap. Each chunk records the parent version, section, offset, text hash and inherited availability date. Full-text chunks use paragraph-local UTF-16 offsets and preserve paragraph indices and section labels. Publication/revision verification remains pending.


## Full-text corpus (current app default)

`cord19-2020-fulltext-v1` preserves the original 168 abstract versions and adds **32 full-text versions**, for **200 versions, 1,265 chunks and 60 quarantine records**. It uses the March historical archive only; year-end full-text coverage is not yet imported. Unmatched papers remain explicitly abstract-only.

The official archive labeled March 13 has S3 Last-Modified **May 19, 2020 01:45:26 UTC**. Full-text availability uses that conservative later bound, independently of the March abstracts. March exposes 44 versions / 66 chunks; May exposes 76 / 1,000. The app creates a separate run for the new frozen corpus and preserves old runs.

Reproduce after downloading the official archive configured in `curation/cord19-fulltext.json`:

```sh
python3 scripts/extract-cord19.py data/cord19/cord-19_2020-03-13.tar.gz data/cord19/parses-2020-03-13
npm run corpus:import -- curation/cord19-fulltext.json --write
node scripts/verify-fulltext.js
```

Extraction detects compression rather than trusting the filename, never unpacks archive paths onto disk, rejects oversized or conflicting parses, and writes an archive-bound hash index. Import checks archive and parse hashes and matches the metadata SHA to the parse paper ID. A full-text content hash covers title, abstract, paragraphs, citation/reference spans, bibliography and reference entries. Frozen imports remain resumable and verified.

Agent `read` and the run-bound evidence endpoint return the complete parsed body with paragraph/section provenance. Search includes body paragraphs but returns lightweight abstract previews; complete body text is fetched on read. Chunk reads retain the parent-date check. The UI renders sections and captions as escaped text, with raw provenance available separately.

**Table limit:** historical CORD-19 parses provide reference entries/captions, not reliable structured cells. Captions are preserved as supplied, without inferring numerical rows or columns. XML/PDF table extraction with independently verified version dates is a separate future task. Parsed full text can also have omissions or extraction errors; it is not a verified transcription of every page.

## Complete 2020 import (in progress)

The expansion configuration is `curation/cord19-complete-2020.json`. It removes topic filters and sample caps and scans **every row** from eleven official metadata snapshots: March 13, March 27, April 24, May 31, June 30, July 31, August 29, September 28, October 31, November 29 and December 31. Both the complete initial archive and the complete year-end `document_parses.tar.gz` are ingested. This is the full year-end 2020 dataset plus earlier observed versions, not the final 2022 CORD-19 release.

`npm run corpus:import-all` hashes inputs, streams all records into a separate staging corpus, supports PDF SHA lists and PMC XML parse paths, then audits every stored paper before freezing. No paper is excluded for low relevance. Invalid publication dates, missing abstracts and unmatched/invalid parses are individually quarantined, with references to the retained hashed raw CSV/archive; missing abstracts do not prevent a valid matched body from being admitted. Some CORD-19 rows have no distributable full text, so a complete dataset import is not full text for every row.

Text is stored once in `papers`; 1,600-character chunks are derived on demand and gated against their parent. Their IDs are `<SHA256(version_id)>:body:<paragraph_index>:<offset>` or `<SHA256(version_id)>:abstract:0:<offset>`. A full-corpus Mongo text index supports retrieval without loading paper bodies into previews. Every source version remains independently dated. Initial metadata unlocks in March, initial parsed bodies conservatively unlock in May, monthly metadata unlocks at its S3 observation date, and year-end-only bodies remain December-gated. Intermediate full-text archives and independently verified January/February versions are still separate coverage work.

The confirmed cluster is M10 with 10 GB provisioned storage. The importer checks corpus storage usage and stops with a resumable staging corpus if its conservative 7 GB threshold is reached, leaving headroom for indexes and other cluster databases. No cluster tier or autoscaling settings are changed. Existing frozen corpora/runs remain intact. The application should switch to `cord19-2020-complete-v1` only after the full freeze audit succeeds.

## Pre-2020 baseline

`coronavirus-pre2020-baseline-v1` is a separately frozen collection of five original review abstracts (PubMed 25720466, 31226023, 30531947, 30058403, 29048984). Europe PMC publication records and original abstracts are retained in `data/baseline/reviews-source.json` with record/source hashes. Conservative availability is December 31, 2019; retrieved metadata is not presented as a historical archive capture and these papers are excluded from precise discovery timing. No 2020 COVID-19 content is admitted. This starter baseline is abstracts, not complete papers.

Import with `node scripts/import-baseline.js`. Set `REPLAY_BASELINE_CORPUS_VERSION=coronavirus-pre2020-baseline-v1` for new runs. Each run pins its baseline version; old saved runs do not silently gain new sources. Search, direct reads, chunks and counts check both frozen sources under the run's monthly cutoff. The main CORD-19 corpus keeps its separate snapshot date gates.

## Interim March–November release

`cord19-2020-through-nov-v1` is a separate immutable copy of completed records available by November 30, 2020. Publication verifies every original record hash, copies under a new corpus version, verifies every destination record and its inventory, and re-hashes the ten completed source inputs before freeze. December source versions are excluded. It shares no mutable paper documents with the continuing staging import. Search uses bounded keyword matching until full-corpus indexing completes; full reads and virtual chunks retain their integrity and date checks. The pre-2020 baseline stays a separately pinned source.

Run `node scripts/publish-early-corpus.js`, then switch the default only after the resulting frozen release passes read-only boundary checks. Existing saved runs remain on their original corpus. This release does not complete intermediate monthly full-text coverage or the whole-archive acceptance audit.
