import {
  KnowledgePublication,
  WikiCandidates,
  type KnowledgeStore,
} from '@repo-knowledge/core';

/** Read-only view inventory. Published candidate files stay archived, never pending again. */
export async function wikiReviewLists(knowledge: KnowledgeStore) {
  const entries = await new KnowledgePublication(knowledge).history();
  const published = new Set(
    entries
      .filter(
        (entry) =>
          entry.state === 'committed' &&
          entry.record.schemaVersion === 3 &&
          entry.record.operation === 'create-wiki',
      )
      .map((entry) => entry.record.itemId),
  );
  const reversed = new Set(
    entries
      .filter(
        (entry) =>
          entry.state === 'committed' &&
          entry.record.schemaVersion === 3 &&
          ['restore-wiki', 'remove-wiki'].includes(entry.record.operation),
      )
      .map((entry) => entry.record.itemId),
  );
  const candidates = (await new WikiCandidates(knowledge).list())
    .filter((value) => !published.has(value.candidate.candidateId))
    .map((value) => ({
      id: value.candidate.candidateId,
      title: value.preview.articles.map((article) => article.title).join(' · '),
    }));
  const history = entries
    .filter(
      (entry) =>
        entry.state === 'committed' && entry.record.schemaVersion === 3,
    )
    .map((entry) => ({
      id: entry.record.transactionId,
      title: entry.record.operation + ' · ' + entry.record.createdAt,
      actionable:
        ['migrate-wiki', 'create-wiki'].includes(entry.record.operation) &&
        !reversed.has(entry.record.transactionId),
    }));
  return { candidates, history };
}
