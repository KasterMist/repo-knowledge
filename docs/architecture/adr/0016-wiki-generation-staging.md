# ADR 0016: Bounded Wiki generation candidates before v2 activation

Status: accepted for T27.3 staging only. Date: 2026-11-14.
Depends on [ADR 0015](0015-wiki-articles.md); tracks [Issue #58](https://github.com/KasterMist/repo-knowledge/issues/58).

## Decision

The unified generation form offers cards or Wiki articles with associated cards.
Opening/changing the form, scanning, reading and recovering saved Wiki results
never start model work. A reviewed nonempty complete plan and a separate native
source-send confirmation are required. Reuse the existing restricted Codex text
turn with its verified version/model policy, no tools/MCP/inherited instructions,
outside-repository/store scratch directory, 60-second deadline and 64 KiB output
limit. No provider, login, proxy or security setting is changed.

One response contains 1–3 overview/architecture/module articles and 1–8 new cards
(the form offers maxima 2/4/8). Articles have at most six sections and eight blocks
per section. Facts reference cards in the same response by ID; every article
requires a card block and every new card must be used. The adapter derives card
revision 1, selected-source hashes, language, article revision and pinned content
bindings. Additional prose can only be model-authored inference; reject model
human/rationale fields and rationale cards. These structural constraints do not
prove prose truth; human review remains required.

## Separate staging format

Store immutable `wiki-candidates/<UUID>.json` in the external knowledge store.
The envelope has `format: wiki-generation-candidate`, its own `schemaVersion: 1`,
candidate ID/time, base snapshot/packet revision, metadata-only scan plan, card
limit, repository metadata and bounded model response. It is **not** canonical
knowledge schema v2. Do not persist the full source packet. Validate IDs, scope,
evidence ranges, output size, hierarchy, references and derived authorship again
when reading. Limit to 100 candidates / 200 directory entries; refuse excess.
Repository/worktree binding is checked by the existing store, and the saved plan
must belong to the same resolved repository root. Reading/listing is bounded;
listing skips source scans, the selected result is rechecked before display.

After response validation, rebuild the packet and check the base. Write a unique
0600 temporary file, sync it, recheck packet/context immediately before exposing
the complete file through an exclusive same-directory hard link, then unlink the
temporary name. Unsupported hard links cause a failure, not a partial canonical
write. There is no overwrite or multi-file publication transaction. A failed or
interrupted write may leave an ignored `.tmp`; directory limits still count it.
Normal completion/cancellation removes that temporary name. A completed save
wins a late cancellation; no automatic retry or model-session resume occurs.

Only saved complete results are recoverable. Failures without a candidate require
a new preview and explicit generation confirmation; there is no failed-job retry
lease in this slice. Recovery selects a saved result, does not generate another
copy, and starts no model. Changed source, Git context or canonical base cannot
be called current; the candidate reader visibly marks it stale or rejects the
context. Candidate facts remain distinct from canonical facts. The prepared
reader deliberately ignores preview cards, so generation uses a separate labelled
candidate reader, not that canonical-reader path. Candidate evidence paths/ranges
are displayed as inert text; privileged navigation/publication is deferred.

## Compatibility, migration and rollback

No `knowledge.json`, v1 card proposal, publication history, MCP, user config or
target source is changed. Old binaries ignore the new directory; no canonical
migration or downgrade is needed. Back up the complete store, including candidates.
To abandon a candidate, preserve/export its entire envelope; nothing published
needs rollback. No automatic deletion or cleanup command is added.

T27.4 must explicitly revalidate/adapt these staging envelopes for coherent
card-and-article review/publication and migration; they are not ordinary v1 card
creations and must not be silently adopted or independently published. The ADR
0015 whole-writer/history/recovery compatibility and rollback gates still apply.
Candidate files are untrusted editable data, not authenticated authorship records.
No real-model quality, visual layout or Remote SSH acceptance is inferred from
self-authored automated fixtures.
