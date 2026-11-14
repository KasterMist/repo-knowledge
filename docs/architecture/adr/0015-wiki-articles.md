# ADR 0015: Shared-card Wiki articles and staged canonical v2

Status: accepted for the T27.1 prepared model only; runtime activation deferred.
Date: 2026-11-14. Tracking: [Issue #58](https://github.com/KasterMist/repo-knowledge/issues/58).

## Decision

Prepare a canonical `schemaVersion: 2` containing the existing repository/cards
plus `articles`. Do not switch KnowledgeStore, MCP, publication or generation
writers in this change. Existing runtime parsers still require v1 and refuse v2;
merely adding this module must never migrate a user's store.

Articles have stable IDs/revisions, kind (overview/architecture/module/guide),
language, parent ID, sibling order, titled sections and typed blocks. Article and
card IDs have separate namespaces and are not filesystem paths. Reject missing
parents, cycles, duplicate IDs/section or block anchors, duplicate sibling order,
and depth beyond eight. Bound snapshots to 1 MiB UTF-8, 64 articles, 20 sections
per article, 20 blocks per section and 8,000 characters per note. Existing card
limits remain. The serialized migration output must also fit the byte budget.

A card block references canonical card ID, revision and the SHA-256 of the
schema-parsed card JSON. Card schema field order defines the hash; meaningful
arrays retain their order. Source evidence stays on that card, rather than being
copied into a second fact store. A changed or missing binding is valid readable
state: the resolver marks it for review and withholds the substitute card body.
It never presents a newer card as the originally referenced revision. No old
body is fabricated; historical viewing must use the actual retained history.

Notes contain Markdown text and explicit context/inference/rationale and
human/model labels, with optional pinned card references. Preserve note body
whitespace. A model-labelled note cannot be a human design rationale. Labels
are stored data, **not authenticated provenance**: future generation adapters
must assign model authorship themselves, refuse spoofed human provenance and
route model conclusions to reviewed cards or labelled inferences. A schema
cannot determine whether prose is true or faithfully summarizes a card.

`resolveWikiArticle` reports only `matches`/`changed`/`missing` knowledge bindings
and `sourceFreshness: unchecked`. Binding matches are not live source validation
or proof of historical design intent. Future readers must resolve evidence on
the same current snapshot; article publication must validate references and
source freshness again under the normal context/revision/write guards.

All Markdown is untrusted data. This module does not render HTML or follow links.
The reader must block executable HTML, command/file/remote resource loading and
unvalidated navigation; it must not pass prose to a privileged command bridge.

## Why one canonical document

A separate freely written Markdown Wiki would duplicate facts and permit drift.
A mutable article sidecar would require cross-file commit/recovery coordination
when cards and articles are published together. One bounded canonical document
allows a future single reviewed atomic snapshot update. It also requires a
coordinated runtime rollout: old writers must never discard unknown articles.
The current strict v1 refusal is safer than partial compatibility.

## Migration and rollback contract

T27.1 implements only deterministic, no-I/O `prepareWikiUpgrade` and
`prepareWikiDowngrade` previews. An upgrade validates v1, adds an empty articles
array, and returns base/target digests and target text requiring review. Card
values/order and repository metadata must remain equal. Since the old schema
trims some fields, refuse inputs whose parsed values would change instead of
silently normalizing human content. JSON formatting/property order may change;
preview is not a byte-identical backup. A downgrade refuses nonempty articles
and any text normalization, preserving current cards rather than restoring old
revisions. No file, backup, history or user setting is written by either helper.

Before enabling an actual migration:

1. Upgrade all readers and all whole-snapshot writers, proposal/draft validators,
   creation/removal/rollback histories, merge/impact/scan consumers and MCP paths
   together; test mixed-version refusal and recovery. Ordinary card updates must
   preserve all articles and make old bindings visibly require review.
2. Offer an explicit migration preview and confirmation. Under the existing
   writer/context guards, recheck the base digest, pending records and Git
   binding, retain the original bytes and a digest-verified transaction/backup,
   then atomically publish the exact reviewed target with recoverable history.
   Opening, scanning or generating must not silently activate migration.
3. Test Windows native, Linux editor-host and required Remote SSH flows; add
   reviewed article creation/update and coherent card/article publication before
   claiming article generation. Old pending records must not be relabelled v2.
4. Restore original bytes only when no later write occurred and the current
   digest still matches the migration target. Otherwise refuse destructive
   restoration and use explicit reviewed export/rollback. Nonempty articles
   must be retained/exported; never strip them to make an old binary open.

Article format and knowledge schema version are distinct from the VSIX version.
No migration command, v2 runtime claim or product release is added in this slice.
