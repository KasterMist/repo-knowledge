import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  GenerationJobs,
  KnowledgePublication,
  KnowledgeStore,
  buildGenerationPacket,
  defaultScanOptions,
  scanRepository,
  generateKnowledgeCandidate,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture();
  try {
    const knowledge = new KnowledgeStore(f.repository, f.store);
    const jobs = new GenerationJobs(knowledge);
    const publication = new KnowledgePublication(knowledge);
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    const packet = await buildGenerationPacket(knowledge, plan);
    const output = {
      packetRevision: packet.packetRevision,
      pages: [
        {
          id: 'job-reading',
          title: '读取说明',
          kind: 'fact',
          body: '空字符串会保留。',
          scope: ['src'],
          tags: [],
          evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
        },
      ],
    };
    const before = await readFile(join(f.store, 'knowledge.json'));
    const save = (job) =>
      publication.saveCreation(plan, packet, output, undefined, job.jobId);
    await action({ ...f, knowledge, jobs, publication, plan, packet, save });
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
  } finally {
    await f.cleanup();
  }
}
test('job receipt is metadata-only and repeated recovery returns one validated candidate without invoking a producer', async () => {
  await setup(async ({ store, jobs, plan, knowledge, save }) => {
    const job = await jobs.create(plan, 2, 60000);
    const text = await readFile(
      join(store, 'generation-jobs', job.jobId + '.json'),
      'utf8',
    );
    assert.ok(!text.includes('空字符串会保留'));
    assert.ok(!text.includes('return cache.get'));
    assert.equal(await jobs.result(job.jobId), undefined);
    let calls = 0;
    const first = await jobs.run(job.jobId, async (current) => {
      calls++;
      await save(current);
    });
    assert.equal(first.recovered, false);
    const second = await new GenerationJobs(knowledge).run(
      job.jobId,
      async () => {
        calls++;
        throw Error('Must not run');
      },
    );
    assert.equal(second.recovered, true);
    assert.equal(second.modelStarted, false);
    assert.equal(second.candidateId, first.candidateId);
    assert.equal(calls, 1);
    assert.equal((await readdir(join(store, 'creations'))).length, 1);
  });
});
test('a saved result survives a producer failure and can be adopted even if a crash left its lease', async () => {
  await setup(async ({ store, jobs, plan, knowledge, save }) => {
    const job = await jobs.create(plan, 2, 60000);
    await assert.rejects(
      jobs.run(job.jobId, async (current) => {
        await save(current);
        throw Error('simulated interruption after durable result');
      }),
    );
    await writeFile(
      join(store, 'generation-jobs', job.jobId + '.lease'),
      'interrupted',
    );
    const result = await new GenerationJobs(knowledge).run(
      job.jobId,
      async () => {
        throw Error('No second attempt');
      },
    );
    assert.equal(result.state, 'pending-review');
    assert.equal(result.recovered, true);
    assert.equal(
      await readFile(
        join(store, 'generation-jobs', job.jobId + '.lease'),
        'utf8',
      ),
      'interrupted',
    );
  });
});
test('failed attempt permits an explicit retry, but a changed source/base refuses the producer', async () => {
  await setup(async ({ jobs, plan, save }) => {
    const job = await jobs.create(plan, 2, 60000);
    await assert.rejects(
      jobs.run(job.jobId, async () => {
        throw Error('network fixture');
      }),
    );
    assert.equal((await jobs.run(job.jobId, save)).recovered, false);
  });
  await setup(async ({ jobs, plan, repository }) => {
    const job = await jobs.create(plan, 2, 60000);
    await writeFile(join(repository, 'src/读取.ts'), 'changed');
    let calls = 0;
    await assert.rejects(
      jobs.run(job.jobId, async () => {
        calls++;
      }),
      code('PLAN_CHANGED'),
    );
    assert.equal(calls, 0);
  });
});
test('concurrent and abandoned leases never start another producer; pre-cancelled work creates no lease', async () => {
  await setup(async ({ jobs, plan, store, save }) => {
    const job = await jobs.create(plan, 2, 60000);
    const c = new globalThis.AbortController();
    c.abort();
    await assert.rejects(
      jobs.run(job.jobId, save, c.signal),
      code('GENERATION_CANCELLED'),
    );
    let release, entered;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const running = new Promise((resolve) => {
      entered = resolve;
    });
    const first = jobs.run(job.jobId, async (current) => {
      entered();
      await gate;
      await save(current);
    });
    await running;
    try {
      await assert.rejects(jobs.run(job.jobId, save), code('JOB_BUSY'));
    } finally {
      release();
      await first;
    }
    const abandoned = await jobs.create(plan, 2, 60000);
    await writeFile(
      join(store, 'generation-jobs', abandoned.jobId + '.lease'),
      'old',
    );
    await assert.rejects(jobs.run(abandoned.jobId, save), code('JOB_BUSY'));
  });
});
test('a stale saved result is refused rather than silently regenerated', async () => {
  await setup(async ({ jobs, plan, repository, save }) => {
    const job = await jobs.create(plan, 2, 60000);
    await jobs.run(job.jobId, save);
    await writeFile(join(repository, 'src/读取.ts'), 'changed');
    let calls = 0;
    await assert.rejects(
      jobs.run(job.jobId, async () => {
        calls++;
      }),
    );
    assert.equal(calls, 0);
  });
});
test('job metadata identity/root binding, bounds and directory containment are checked', async () => {
  await setup(async ({ jobs, plan, store, directory, repository }) => {
    await assert.rejects(jobs.create(plan, 0, 60000));
    const job = await jobs.create(plan, 2, 60000);
    const other = join(directory, 'other-repository');
    await cp(repository, other, { recursive: true });
    await assert.rejects(
      new GenerationJobs(new KnowledgeStore(other, store)).read(job.jobId),
      code('INVALID_JOB'),
    );
    const path = join(store, 'generation-jobs', job.jobId + '.json');
    await writeFile(
      path,
      JSON.stringify({ ...job, jobId: '00000000-0000-4000-8000-000000000000' }),
    );
    await assert.rejects(jobs.read(job.jobId), code('INVALID_JOB'));
  });
  await setup(async ({ knowledge, store, directory }) => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      join(store, 'generation-jobs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      new GenerationJobs(knowledge).list(),
      code('PATH_ESCAPE'),
    );
    assert.deepEqual(await readdir(outside), []);
  });
});
test('adapter rejects a mismatched saved packet before backend preflight or source transfer', async () => {
  await setup(async ({ knowledge, plan, directory }) => {
    const cwd = join(directory, 'scratch');
    await mkdir(cwd);
    await assert.rejects(
      generateKnowledgeCandidate({
        knowledge,
        plan,
        cwd,
        command: process.execPath,
        maxPages: 2,
        timeoutMs: 1000,
        expectedPacketRevision: '0'.repeat(64),
      }),
      code('GENERATION_BASE_CHANGED'),
    );
  });
});

test('canonical-base change blocks retry before the producer is invoked', async () => {
  await setup(async ({ jobs, plan, store }) => {
    const job = await jobs.create(plan, 2, 60000);
    const path = join(store, 'knowledge.json');
    const original = await readFile(path);
    let calls = 0;
    try {
      await writeFile(path, original.toString('utf8') + ' ');
      await assert.rejects(
        jobs.run(job.jobId, async () => {
          calls++;
        }),
        code('GENERATION_BASE_CHANGED'),
      );
      assert.equal(calls, 0);
    } finally {
      await writeFile(path, original);
    }
  });
});

test('published and later removed results never generate or publish again through recovery', async () => {
  await setup(async ({ jobs, plan, store, save, publication }) => {
    const original = await readFile(join(store, 'knowledge.json'));
    try {
      const job = await jobs.create(plan, 2, 60000);
      await jobs.run(job.jobId, save);
      const review = await publication.previewCreation(job.jobId);
      const committed = await publication.publishCreation(
        job.jobId,
        review.token,
      );
      let calls = 0;
      const never = async () => {
        calls++;
      };
      assert.equal(
        (await jobs.run(job.jobId, never)).state,
        'previously-published',
      );
      const undo = await publication.previewRollback(committed.transactionId);
      await publication.rollback(committed.transactionId, undo.token);
      assert.equal(
        (await jobs.run(job.jobId, never)).state,
        'previously-published',
      );
      assert.equal(calls, 0);
      assert.equal((await publication.history()).length, 2);
    } finally {
      await writeFile(join(store, 'knowledge.json'), original);
    }
  });
});
