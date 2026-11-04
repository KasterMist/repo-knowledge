import { z } from 'zod';
import { KnowledgeStore } from './store.js';
import { cardSchema } from './schema.js';
import { fingerprint, KnowledgeError } from './files.js';
import {
  scanPlanSchema,
  scanRepository,
  verifyScanPlan,
  type ScanPlan,
} from './scan.js';

const dependency = cardSchema.pick({ id: true, scope: true, evidence: true });
const baselineContent = z.strictObject({
  schemaVersion: z.literal(1),
  plan: scanPlanSchema,
  snapshotRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  cards: z.array(dependency).max(200),
});
const baselineSchema = baselineContent.extend({ revision: z.string() });
const complete = (plan: ScanPlan) =>
  !plan.summary.limited &&
  Object.entries(plan.summary.skipped).every(
    ([reason, count]) =>
      count === 0 || reason === 'excluded' || reason === 'out-of-scope',
  );
const inScope = (path: string, scope: string) =>
  path === scope || path.startsWith(scope + '/');

/** In-memory metadata only. No persistence, watcher, model, or canonical write. */
export async function captureDependencyBaseline(
  knowledge: KnowledgeStore,
  input: unknown,
  signal?: AbortSignal,
) {
  const plan = await verifyScanPlan(
    knowledge.repositoryRoot,
    knowledge.storeRoot,
    input,
    signal,
  );
  const current = await knowledge.snapshot();
  const content = baselineContent.parse({
    schemaVersion: 1,
    plan,
    snapshotRevision: current.snapshotRevision,
    cards: current.snapshot.cards.map(({ id, scope, evidence }) => ({
      id,
      scope,
      evidence,
    })),
  });
  return { ...content, revision: fingerprint(JSON.stringify(content)) };
}

export async function reviewDependencyImpact(
  knowledge: KnowledgeStore,
  input: unknown,
  signal?: AbortSignal,
) {
  const baseline = baselineSchema.parse(input);
  const content = baselineContent.parse({
    schemaVersion: baseline.schemaVersion,
    plan: baseline.plan,
    snapshotRevision: baseline.snapshotRevision,
    cards: baseline.cards,
  });
  if (fingerprint(JSON.stringify(content)) !== baseline.revision)
    throw new KnowledgeError('INVALID_BASELINE', 'Dependency baseline changed');
  if (
    (await knowledge.snapshot()).snapshotRevision !== baseline.snapshotRevision
  )
    throw new KnowledgeError(
      'IMPACT_BASE_CHANGED',
      'Knowledge changed; capture a fresh baseline',
    );
  const current = await scanRepository(
    knowledge.repositoryRoot,
    knowledge.storeRoot,
    baseline.plan.options,
    signal,
  );
  if (current.repositoryId !== baseline.plan.repositoryId)
    throw new KnowledgeError(
      'IMPACT_ROOT_CHANGED',
      'Baseline belongs to another repository',
    );
  const before = new Map(
    baseline.plan.files.map((file) => [file.path, file.sha256]),
  );
  const after = new Map(current.files.map((file) => [file.path, file.sha256]));
  const lines = new Map(current.files.map((file) => [file.path, file.lines]));
  const coverageComplete = complete(baseline.plan) && complete(current);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = paths.flatMap((path) => {
    if (before.get(path) === after.get(path)) return [];
    const kind = !before.has(path)
      ? 'added'
      : !after.has(path)
        ? coverageComplete
          ? 'deleted'
          : 'unobserved'
        : 'changed';
    return [{ path, kind }];
  });
  const cards = baseline.cards.map((card) => {
    const evidence = card.evidence.map((reference) => {
      const hash = after.get(reference.path);
      const state = hash
        ? reference.endLine > (lines.get(reference.path) ?? 0)
          ? 'invalid-range'
          : hash === reference.sha256
            ? 'current'
            : 'changed'
        : coverageComplete && before.has(reference.path)
          ? 'missing'
          : 'unknown';
      return { path: reference.path, state };
    });
    const scopeChanges = changes.filter((change) =>
      card.scope.some((scope) => inScope(change.path, scope)),
    );
    const state = evidence.some(
      (e) =>
        e.state === 'changed' ||
        e.state === 'missing' ||
        e.state === 'invalid-range',
    )
      ? 'invalid-evidence'
      : !coverageComplete || evidence.some((e) => e.state === 'unknown')
        ? 'unknown'
        : scopeChanges.length
          ? 'potential-impact'
          : 'current';
    return { id: card.id, state, evidence, scopeChanges };
  });
  if (
    (await knowledge.snapshot()).snapshotRevision !== baseline.snapshotRevision
  )
    throw new KnowledgeError(
      'IMPACT_BASE_CHANGED',
      'Knowledge changed during review',
    );
  return {
    coverageComplete,
    changes,
    cards,
    modelRequests: 0,
    published: false,
  };
}
