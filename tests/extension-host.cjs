const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

// Self-authored completed-candidate fixture. This does not stand in for a model turn.
async function checkWikiCandidate(extension, folder, target, plan) {
  const crypto = require('node:crypto');
  const fingerprint = (text) =>
    crypto
      .createHash('sha256')
      .update(text.replaceAll('\r\n', '\n'))
      .digest('hex');
  const base = await target.knowledge.snapshot();
  const original = await fs.readFile(path.join(target.store, 'knowledge.json'));
  const sources = [];
  for (const file of plan.files)
    sources.push({
      path: file.path,
      sha256: file.sha256,
      lines: file.lines,
      content: (
        await fs.readFile(path.join(target.root, file.path), 'utf8')
      ).replaceAll('\r\n', '\n'),
    });
  const packetRevision = fingerprint(
    JSON.stringify({
      schemaVersion: 1,
      repositoryId: plan.repositoryId,
      planId: plan.id,
      planRevision: plan.manifestRevision,
      baseSnapshot: base.snapshotRevision,
      language: plan.options.language,
      existingIds: base.snapshot.cards.map((card) => card.id).sort(),
      sources,
    }),
  );
  const candidateId = crypto.randomUUID();
  const output = {
    packetRevision,
    pages: [
      {
        id: 'wiki-host-card',
        title: '候选读取说明',
        kind: 'fact',
        body: '自编候选，不是正式知识。',
        tags: [],
        scope: ['src'],
        evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
      },
    ],
    articles: [
      {
        id: 'generated-overview',
        title: '生成候选概述',
        kind: 'overview',
        parentId: null,
        order: 0,
        sections: [
          {
            id: 'read',
            title: '共享事实',
            blocks: [{ id: 'card', type: 'card', cardId: 'wiki-host-card' }],
          },
        ],
      },
    ],
  };
  await fs.mkdir(path.join(target.store, 'wiki-candidates'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(target.store, 'wiki-candidates', candidateId + '.json'),
    JSON.stringify({
      format: 'wiki-generation-candidate',
      schemaVersion: 1,
      candidateId,
      createdAt: new Date().toISOString(),
      baseSnapshot: base.snapshotRevision,
      packetRevision,
      plan,
      maxPages: 2,
      repository: base.snapshot.repository,
      output,
    }),
  );
  const preview = await extension.exports.wikiReader.openCandidate(
    folder,
    candidateId,
  );
  assert.equal(preview.repository, target.root);
  const view = await preview.handle({
    action: 'article',
    id: 'generated-overview',
  });
  assert.equal(view.sourceFreshness, 'current');
  assert.equal(view.sections[0].blocks[0].card.id, 'wiki-host-card');
  assert.deepEqual(
    await fs.readFile(path.join(target.store, 'knowledge.json')),
    original,
  );
  assert.ok(!base.snapshot.cards.some((card) => card.id === 'wiki-host-card'));
}

async function runMultiRoot(extension) {
  const workbench = extension.exports.workbench;
  const roots = await workbench.cards.getChildren();
  assert.equal(roots.length, 2);
  const firstCards = await workbench.cards.getChildren(roots[0]);
  const secondCards = await workbench.cards.getChildren(roots[1]);
  const first = firstCards.find((node) => node.cardId === 'read-fallback');
  const second = secondCards.find((node) => node.cardId === 'read-fallback');
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.target.store, second.target.store);
  assert.notEqual(first.target.root, second.target.root);
  const secondView = await vscode.commands.executeCommand(
    'repoKnowledge.openCard',
    second,
  );
  assert.match(
    (await vscode.workspace.openTextDocument(secondView)).getText(),
    /SECOND_ROOT_SENTINEL/u,
  );
  const firstView = await vscode.commands.executeCommand(
    'repoKnowledge.openCard',
    first,
  );
  assert.doesNotMatch(
    (await vscode.workspace.openTextDocument(firstView)).getText(),
    /SECOND_ROOT_SENTINEL/u,
  );
  const evidence = await workbench.cards.getChildren(second);
  const source = await vscode.commands.executeCommand(
    'repoKnowledge.openEvidence',
    evidence[0],
  );
  assert.equal(
    await fs.realpath(source.fsPath),
    await fs.realpath(path.join(second.target.root, 'src/读取.ts')),
  );
  const panel = await extension.exports.generationPanel.open(second.folder);
  assert.equal(panel.repository, second.target.root);
  await panel.session.handle({
    action: 'preview',
    form: {
      include: 'src/**/*.ts',
      exclude: '',
      language: 'zh-CN',
      maxFiles: '10',
      maxKiB: '128',
      maxPages: '2',
      output: 'wiki',
    },
  });
  assert.equal(panel.session.state.phase, 'previewed');
  await checkWikiCandidate(
    extension,
    second.folder,
    second.target,
    panel.session.state.plan,
  );
  assert.equal(
    panel.session.state.plan.repositoryId,
    require('node:crypto')
      .createHash('sha256')
      .update(second.target.root)
      .digest('hex'),
  );
  const wiki = await extension.exports.wikiReader.open(
    second.folder,
    await fs.readFile(
      path.join(second.target.root, 'wiki-preview.json'),
      'utf8',
    ),
  );
  assert.equal(wiki.repository, second.target.root);
  const article = await wiki.handle({ action: 'article', id: 'cache-module' });
  assert.equal(article.sourceFreshness, 'current');
  const entry = article.evidence[0];
  const wikiSource = await wiki.handle({
    action: 'evidence',
    cardId: entry.cardId,
    index: entry.index,
    revision: article.snapshotRevision,
  });
  assert.equal(
    await fs.realpath(wikiSource.fsPath),
    await fs.realpath(path.join(second.target.root, entry.path)),
  );
  await fs.writeFile(
    process.env.REPO_KNOWLEDGE_HOST_RESULT,
    JSON.stringify({
      passed: true,
      vscodeVersion: vscode.version,
      platform: process.platform,
      evidence: [
        'two real workspace folders',
        'same card ID uses distinct configured stores',
        'pinned first node remains isolated after second read',
        'second-root evidence opens its own source',
        'generation form preview remains pinned to the selected second root',
        'Wiki generation mode and completed candidate reader stay pinned to the selected second root without publication',
        'Wiki article reader and evidence remain pinned to the selected second root',
      ],
    }),
  );
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('KasterMist.repo-knowledge');
  assert.ok(extension, 'Packaged extension must be discoverable');
  await extension.activate();
  assert.equal(extension.isActive, true);
  if (process.env.REPO_KNOWLEDGE_MULTI_ROOT === '1')
    return runMultiRoot(extension);
  const commands = await vscode.commands.getCommands(true);
  for (const command of extension.packageJSON.contributes.commands)
    assert.ok(commands.includes(command.command), command.command);
  const opened = await vscode.commands.executeCommand(
    'repoKnowledge.openSnapshot',
  );
  assert.ok(!opened?.error, opened?.message);
  const document = vscode.window.activeTextEditor?.document;
  assert.equal(path.basename(document?.fileName ?? ''), 'knowledge.json');
  assert.equal(JSON.parse(document.getText()).cards.length, 3);
  assert.equal(
    JSON.parse(document.getText()).repository.id,
    'self-authored-demo',
  );
  if (vscode.env.remoteName) {
    assert.equal(vscode.env.remoteName, 'ssh-remote');
    assert.equal(document.uri.scheme, 'file');
    assert.equal(
      document.uri.authority,
      vscode.workspace.workspaceFolders[0].uri.authority,
    );
  }
  await vscode.commands.executeCommand('repoKnowledge.codexSetup');
  const guide = vscode.window.activeTextEditor?.document.getText() ?? '';
  assert.match(guide, /\[mcp_servers.repo_knowledge\]/u);
  assert.match(guide, /server\.cjs/u);
  const diagnostics = await vscode.commands.executeCommand(
    'repoKnowledge.diagnostics',
  );
  assert.equal(diagnostics?.protocolConnected, true);
  assert.equal(diagnostics.tools.length, 4);
  const home = await vscode.commands.executeCommand('repoKnowledge.openHome');
  assert.equal(home.cardCount, 3);
  assert.equal(home.problem, '');
  assert.equal(
    await fs.realpath(home.repository),
    await fs.realpath(vscode.workspace.workspaceFolders[0].uri.fsPath),
  );

  const workbench = extension.exports.workbench;
  const roots = await workbench.cards.getChildren();
  const noPlan = await vscode.commands.executeCommand(
    'repoKnowledge.generateKnowledge',
    roots[0],
  );
  assert.equal(noPlan?.error, true);
  assert.match(noPlan.message, /Preview a plan/u);
  const noUpdatePlan = await vscode.commands.executeCommand(
    'repoKnowledge.generateKnowledgeUpdate',
    roots[0],
  );
  assert.equal(noUpdatePlan?.error, true);
  assert.match(noUpdatePlan.message, /Plan Knowledge Generation/u);
  const noUpdateAttempt = await vscode.commands.executeCommand(
    'repoKnowledge.recoverIncrementalUpdate',
    roots[0],
  );
  assert.equal(noUpdateAttempt?.error, true);
  assert.match(
    noUpdateAttempt.message,
    /Incremental records require an external store/u,
  );
  const noJob = await vscode.commands.executeCommand(
    'repoKnowledge.recoverGeneration',
    roots[0],
  );
  assert.equal(noJob?.error, true);
  assert.match(noJob.message, /No saved generation jobs/u);
  const cards = await workbench.cards.getChildren(roots[0]);
  assert.equal(cards.length, 3);
  const readNode = cards.find((card) => card.cardId === 'read-fallback');
  assert.ok(readNode);
  const cardUri = await vscode.commands.executeCommand(
    'repoKnowledge.openCard',
    readNode,
  );
  assert.equal(cardUri.scheme, 'repo-knowledge');
  assert.match(
    vscode.window.activeTextEditor.document.getText(),
    /read-fallback/u,
  );
  const evidence = await workbench.cards.getChildren(readNode);
  assert.equal(evidence[0].description, 'current');
  const sourceUri = await vscode.commands.executeCommand(
    'repoKnowledge.openEvidence',
    evidence[0],
  );
  assert.equal(sourceUri.scheme, 'file');
  assert.equal(path.basename(sourceUri.fsPath), '读取.ts');
  assert.equal(vscode.window.activeTextEditor.selection.start.line, 0);
  const wikiBefore = await fs.readFile(
    path.join(readNode.target.store, 'knowledge.json'),
  );
  const wiki = await vscode.commands.executeCommand(
    'repoKnowledge.openWikiPreview',
    roots[0],
    await fs.readFile(
      path.join(readNode.target.root, 'wiki-preview.json'),
      'utf8',
    ),
  );
  assert.equal(wiki.reader.catalog().length, 2);
  const article = await wiki.handle({ action: 'article', id: 'overview' });
  assert.equal(article.sourceFreshness, 'current');
  assert.equal(article.preview, true);
  const wikiEvidence = article.evidence[0];
  const wikiSource = await wiki.handle({
    action: 'evidence',
    cardId: wikiEvidence.cardId,
    index: wikiEvidence.index,
    revision: article.snapshotRevision,
  });
  assert.equal(
    await fs.realpath(wikiSource.fsPath),
    await fs.realpath(path.join(readNode.target.root, 'src/读取.ts')),
  );
  assert.equal(
    (await wiki.handle({ action: 'article', id: 'not-in-catalog' })).error,
    true,
  );
  assert.equal(
    (await wiki.handle({ action: 'refresh' })).sourceFreshness,
    'current',
  );
  assert.deepEqual(
    await fs.readFile(path.join(readNode.target.store, 'knowledge.json')),
    wikiBefore,
  );
  const impactUri = workbench.documents.create('host-impact.json', '{}');
  extension.exports.impactNavigation.remember(impactUri, {
    target: readNode.target,
    revision: (await readNode.target.knowledge.snapshot()).snapshotRevision,
    files: ['src/读取.ts', 'src/deleted.ts'],
    cards: ['read-fallback'],
  });
  const activateReport = async () =>
    vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(impactUri),
      { preview: false },
    );
  await activateReport();
  const jump = await vscode.commands.executeCommand(
    'repoKnowledge.openImpactTarget',
    { kind: 'file', value: 'src/读取.ts' },
  );
  assert.equal(jump.scheme, 'file', JSON.stringify(jump));
  assert.equal(path.basename(jump.fsPath), '读取.ts');
  await activateReport();
  const missing = await vscode.commands.executeCommand(
    'repoKnowledge.openImpactTarget',
    { kind: 'file', value: 'src/deleted.ts' },
  );
  assert.equal(missing.error, true);
  assert.match(missing.message, /Source path is missing/u);
  const rejected = await vscode.commands.executeCommand(
    'repoKnowledge.openImpactTarget',
    { kind: 'file', value: '../secret' },
  );
  assert.equal(rejected.error, true);
  const impactCard = await vscode.commands.executeCommand(
    'repoKnowledge.openImpactTarget',
    { kind: 'card', value: 'read-fallback' },
  );
  assert.equal(impactCard.scheme, 'repo-knowledge');
  assert.equal(
    JSON.parse(vscode.window.activeTextEditor.document.getText()).card.id,
    'read-fallback',
  );
  const wikiRoots = await workbench.wiki.getChildren();
  const scope = await workbench.wiki.getChildren(wikiRoots[0]);
  assert.equal(scope[0].label, 'src');
  const files = await workbench.wiki.getChildren(scope[0]);
  assert.ok(files.some((file) => file.label === '读取.ts'));
  await vscode.commands.executeCommand('repoKnowledge.refreshKnowledge');
  const snapshotPath = path.join(readNode.target.store, 'knowledge.json');
  const beforeDraft = await fs.readFile(snapshotPath);
  const draft = await vscode.commands.executeCommand(
    'repoKnowledge.editCard',
    readNode,
  );
  assert.ok(draft?.draftId);
  assert.equal(vscode.window.activeTextEditor.document.uri.scheme, 'file');
  const draftDocument = vscode.window.activeTextEditor.document;
  const editedDraft = JSON.parse(draftDocument.getText());
  editedDraft.proposedCard.body += '\n人工说明：空字符串会原样返回。';
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    draftDocument.uri,
    new vscode.Range(
      draftDocument.positionAt(0),
      draftDocument.positionAt(draftDocument.getText().length),
    ),
    JSON.stringify(editedDraft, null, 2),
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  assert.equal(draftDocument.isDirty, true);
  const draftRoots = await workbench.publication.drafts.getChildren();
  const draftNodes = await workbench.publication.drafts.getChildren(
    draftRoots[0],
  );
  const draftNode = draftNodes.find((node) => node.itemId === draft.draftId);
  assert.ok(draftNode);
  const dirtySubmit = await vscode.commands.executeCommand(
    'repoKnowledge.submitDraft',
    draftNode,
  );
  assert.equal(dirtySubmit?.error, true);
  assert.match(dirtySubmit.message, /未保存|dirty/u);
  assert.equal(await draftDocument.save(), true);
  const pending = await vscode.commands.executeCommand(
    'repoKnowledge.submitDraft',
    draftNode,
  );
  assert.equal(pending?.state, 'pending-review');
  const proposalRoots = await workbench.publication.proposals.getChildren();
  const proposalNodes = await workbench.publication.proposals.getChildren(
    proposalRoots[0],
  );
  const proposalNode = proposalNodes.find(
    (node) => node.itemId === pending.proposalId,
  );
  assert.ok(proposalNode);
  const diff = await vscode.commands.executeCommand(
    'repoKnowledge.reviewProposal',
    proposalNode,
  );
  assert.equal(diff.before.scheme, 'repo-knowledge');
  assert.equal(diff.after.scheme, 'repo-knowledge');
  assert.equal(
    JSON.parse((await vscode.workspace.openTextDocument(diff.after)).getText())
      .revision,
    2,
  );
  assert.deepEqual(await fs.readFile(snapshotPath), beforeDraft);
  const historyRoots = await workbench.publication.history.getChildren();
  assert.equal(
    (await workbench.publication.history.getChildren(historyRoots[0])).length,
    0,
  );
  const recovery = [];
  const scanOptions = {
    include: ['src/**/*.ts'],
    exclude: [],
    language: 'zh-CN',
    maxFiles: 10,
    maxFileBytes: 65536,
    maxTotalBytes: 131072,
  };
  const generationPanel = await vscode.commands.executeCommand(
    'repoKnowledge.openGenerationPanel',
    roots[0],
  );
  const form = {
    include: 'src/**/*.ts',
    exclude: '',
    language: 'zh-CN',
    maxFiles: '10',
    maxKiB: '128',
    maxPages: '2',
    output: 'cards',
  };
  await generationPanel.session.handle({ action: 'preview', form });
  assert.equal(generationPanel.session.state.phase, 'previewed');
  assert.equal(generationPanel.session.state.plan.files.length, 2);
  await checkWikiCandidate(
    extension,
    roots[0].folder,
    readNode.target,
    generationPanel.session.state.plan,
  );
  const panelPlanId = generationPanel.session.state.plan.id;
  await workbench.scanning.preview(roots[0], scanOptions, {
    signal: globalThis.AbortSignal.timeout(10000),
    reveal: false,
  });
  await generationPanel.session.handle({
    action: 'generate',
    form,
    planId: panelPlanId,
  });
  assert.equal(generationPanel.session.state.phase, 'failed');
  assert.match(
    generationPanel.session.state.error,
    /Another preview replaced/u,
  );
  await generationPanel.session.handle({ action: 'preview', form });
  await generationPanel.session.handle({
    action: 'generate',
    form: { ...form, maxPages: '4' },
    planId: generationPanel.session.state.plan.id,
  });
  assert.match(generationPanel.session.state.error, /PREVIEW_REQUIRED/u);
  assert.deepEqual(await fs.readFile(snapshotPath), beforeDraft);
  const scan = await vscode.commands.executeCommand(
    'repoKnowledge.planGeneration',
    roots[0],
    scanOptions,
  );
  assert.equal(scan.uri.scheme, 'repo-knowledge');
  assert.deepEqual(
    scan.plan.files.map((file) => file.path),
    ['src/cache.ts', 'src/读取.ts'],
  );
  assert.equal(scan.plan.summary.limited, false);
  assert.equal(
    JSON.parse((await vscode.workspace.openTextDocument(scan.uri)).getText())
      .manifestRevision,
    scan.plan.manifestRevision,
  );
  assert.deepEqual(await fs.readFile(snapshotPath), beforeDraft);
  // Only the runner-owned disposable profile may change a machine setting.
  if (process.env.REPO_KNOWLEDGE_CREATION_ID) {
    const creationRoots = await workbench.publication.creations.getChildren();
    const nodes = await workbench.publication.creations.getChildren(
      creationRoots[0],
    );
    const node = nodes.find(
      (entry) => entry.itemId === process.env.REPO_KNOWLEDGE_CREATION_ID,
    );
    assert.ok(node);
    assert.equal(nodes.length, 1);
    assert.match(node.description, /批次 · 2 张卡片 \/ Batch · 2 cards/u);
    assert.match(node.tooltip, /Candidate batch\n2 张卡片 \/ 2 cards/u);
    const firstPublish = await vscode.commands.executeCommand(
      'repoKnowledge.publishCreation',
      node,
    );
    assert.equal(firstPublish?.reviewRequired, true);
    assert.deepEqual(await fs.readFile(snapshotPath), beforeDraft);
    const diff = await vscode.commands.executeCommand(
      'repoKnowledge.reviewCreation',
      node,
    );
    assert.deepEqual(
      JSON.parse(
        (await vscode.workspace.openTextDocument(diff.before)).getText(),
      ),
      [],
    );
    const newCards = JSON.parse(
      (await vscode.workspace.openTextDocument(diff.after)).getText(),
    );
    assert.equal(newCards[0].id, 'host-new-card');
    assert.equal(newCards.length, 2);
    assert.equal(newCards[0].revision, 1);
    assert.equal(diff.before.scheme, 'repo-knowledge');
    assert.equal(diff.after.scheme, 'repo-knowledge');
  }
  // The remote fallback runner must never modify a maintainer's real profile.
  if (process.env.REPO_KNOWLEDGE_ISOLATED_PROFILE === '1') {
    const folder = vscode.workspace.workspaceFolders[0];
    const configuration = vscode.workspace.getConfiguration(
      'repoKnowledge',
      folder.uri,
    );
    const storeSetting = configuration.inspect('storeDirectory').workspaceValue;
    const nodeSetting = configuration.inspect('nodeExecutable').globalValue;
    const backendSetting = configuration.inspect('codexExecutable').globalValue;
    const originalStore = configuration.get('storeDirectory');
    const originalSnapshot = await fs.readFile(
      path.join(originalStore, 'knowledge.json'),
    );
    const scratch = path.join(folder.uri.fsPath, '.host-recovery');
    await fs.mkdir(scratch, { recursive: true });
    const selectStore = (value) =>
      configuration.update(
        'storeDirectory',
        value,
        vscode.ConfigurationTarget.Workspace,
      );
    const restoredDiagnostic = async () => {
      const result = await vscode.commands.executeCommand(
        'repoKnowledge.diagnostics',
      );
      assert.equal(result?.protocolConnected, true, result?.message);
    };
    try {
      if (process.env.REPO_KNOWLEDGE_CREATION_HISTORY_STORE) {
        const historyStore = process.env.REPO_KNOWLEDGE_CREATION_HISTORY_STORE;
        await selectStore(historyStore);
        const bytes = await fs.readFile(
          path.join(historyStore, 'knowledge.json'),
        );
        const roots = await workbench.publication.history.getChildren();
        const entries = await workbench.publication.history.getChildren(
          roots[0],
        );
        const node = entries.find(
          (entry) =>
            entry.itemId === process.env.REPO_KNOWLEDGE_CREATION_HISTORY_ID,
        );
        assert.ok(node);
        assert.match(node.label, /host-history-card/u);
        const history = await vscode.commands.executeCommand(
          'repoKnowledge.openHistory',
          node,
        );
        assert.equal(
          JSON.parse(
            (await vscode.workspace.openTextDocument(history.before)).getText(),
          ).cards.length,
          3,
        );
        assert.equal(
          JSON.parse(
            (await vscode.workspace.openTextDocument(history.after)).getText(),
          ).cards.length,
          4,
        );
        const removal = await vscode.commands.executeCommand(
          'repoKnowledge.rollbackKnowledge',
          node,
        );
        assert.equal(removal?.reviewRequired, true);
        assert.deepEqual(
          await fs.readFile(path.join(historyStore, 'knowledge.json')),
          bytes,
        );
        await selectStore(storeSetting);
        recovery.push(
          'creation history: v2 snapshot diff and removal preview; no deletion without confirmation',
        );
      }
      const planStore = path.join(
        path.dirname(folder.uri.fsPath),
        'scan-plan-external',
      );
      await selectStore(planStore);
      await fs.mkdir(planStore, { recursive: true });
      const emptyUpdates = await vscode.commands.executeCommand(
        'repoKnowledge.recoverIncrementalUpdate',
      );
      assert.equal(emptyUpdates?.error, true);
      assert.match(emptyUpdates.message, /No incremental update attempts/u);
      const externalPlan = await vscode.commands.executeCommand(
        'repoKnowledge.planGeneration',
        roots[0],
        scanOptions,
      );
      assert.equal(externalPlan.plan.files.length, 2);
      const savedPlan = await vscode.commands.executeCommand(
        'repoKnowledge.saveGenerationPlan',
        roots[0],
      );
      assert.equal(
        await fs.realpath(path.dirname(path.dirname(savedPlan.path))),
        await fs.realpath(planStore),
      );
      assert.equal(
        JSON.parse(await fs.readFile(savedPlan.path, 'utf8')).id,
        externalPlan.plan.id,
      );
      await selectStore(storeSetting);
      recovery.push(
        'scan plan: explicit bounded preview and external save; canonical bytes unchanged',
      );
      for (const [name, content, expected] of [
        ['missing-store', undefined, /knowledge\.json/u],
        ['malformed-store', '{', /schemaVersion 1/u],
        ['unknown-schema', '{"schemaVersion":99}', /schemaVersion 1/u],
      ]) {
        const brokenStore = path.join(scratch, name);
        if (content !== undefined) {
          await fs.mkdir(brokenStore, { recursive: true });
          await fs.writeFile(path.join(brokenStore, 'knowledge.json'), content);
        }
        await selectStore(brokenStore);
        const opened = await vscode.commands.executeCommand(
          'repoKnowledge.openSnapshot',
        );
        assert.equal(opened?.error, true);
        assert.match(opened.message, expected);
        const failed = await vscode.commands.executeCommand(
          'repoKnowledge.diagnostics',
        );
        assert.equal(failed?.error, true);
        assert.match(failed.message, expected);
        await selectStore(storeSetting);
        await restoredDiagnostic();
        recovery.push(`${name}: clear error and recovery`);
      }
      const missingNode = path.join(scratch, 'missing-node-executable');
      await configuration.update(
        'nodeExecutable',
        missingNode,
        vscode.ConfigurationTarget.Global,
      );
      const failed = await vscode.commands.executeCommand(
        'repoKnowledge.diagnostics',
      );
      assert.equal(failed?.error, true);
      assert.match(failed.message, /nodeExecutable/u);
      await configuration.update(
        'nodeExecutable',
        nodeSetting,
        vscode.ConfigurationTarget.Global,
      );
      await restoredDiagnostic();
      recovery.push('missing-node: clear error and recovery');
      await configuration.update(
        'codexExecutable',
        missingNode,
        vscode.ConfigurationTarget.Global,
      );
      const missingBackend = await vscode.commands.executeCommand(
        'repoKnowledge.diagnoseGenerationBackend',
      );
      assert.equal(missingBackend?.error, true);
      assert.match(missingBackend.message, /Codex executable not found/u);
      await configuration.update(
        'codexExecutable',
        backendSetting,
        vscode.ConfigurationTarget.Global,
      );
      recovery.push(
        'backend: missing host executable gives an explicit error; setting restored without starting a thread',
      );
      const emptyStore = path.join(scratch, 'initialized-store');
      await selectStore(emptyStore);
      await vscode.commands.executeCommand('repoKnowledge.initialize');
      const initialized = await fs.readFile(
        path.join(emptyStore, 'knowledge.json'),
      );
      assert.deepEqual(JSON.parse(initialized).cards, []);
      const repeated = await vscode.commands.executeCommand(
        'repoKnowledge.initialize',
      );
      assert.equal(repeated?.error, true);
      assert.match(repeated.message, /already exists/u);
      assert.deepEqual(
        await fs.readFile(path.join(emptyStore, 'knowledge.json')),
        initialized,
      );
      recovery.push('initialize: empty store created; repeat preserves bytes');
    } finally {
      await configuration.update(
        'codexExecutable',
        backendSetting,
        vscode.ConfigurationTarget.Global,
      );
      await selectStore(storeSetting);
      await configuration.update(
        'nodeExecutable',
        nodeSetting,
        vscode.ConfigurationTarget.Global,
      );
    }
    await restoredDiagnostic();
    assert.deepEqual(
      await fs.readFile(path.join(originalStore, 'knowledge.json')),
      originalSnapshot,
    );
  }
  // Self-authored fixture only: simulate a later human revision, inspect three-way
  // UI without confirming a draft/publication, then restore exact original bytes.
  const mergeBefore = await fs.readFile(snapshotPath);
  try {
    const snapshot = JSON.parse(mergeBefore);
    const card = snapshot.cards.find((card) => card.id === 'read-fallback');
    card.revision += 1;
    card.body = '人工设计理由 / Human rationale preserved';
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
    const currentBytes = await fs.readFile(snapshotPath);
    const merge = await vscode.commands.executeCommand(
      'repoKnowledge.mergeProposal',
      proposalNode,
    );
    assert.equal(merge?.reviewRequired, true, merge?.message);
    assert.equal(merge.uri.scheme, 'repo-knowledge');
    const report = JSON.parse(
      (await vscode.workspace.openTextDocument(merge.uri)).getText(),
    );
    assert.deepEqual(report.conflicts, ['body']);
    assert.equal(report.current.body, card.body);
    assert.equal(report.merged.body, card.body);
    assert.equal(report.proposed.body, editedDraft.proposedCard.body);
    assert.deepEqual(await fs.readFile(snapshotPath), currentBytes);
  } finally {
    await fs.writeFile(snapshotPath, mergeBefore);
  }
  await fs.writeFile(
    process.env.REPO_KNOWLEDGE_HOST_RESULT ||
      path.join(
        vscode.workspace.workspaceFolders[0].uri.fsPath,
        'host-result.json',
      ),
    JSON.stringify(
      {
        passed: true,
        vscodeVersion: vscode.version,
        platform: process.platform,
        extensionVersion: extension.packageJSON.version,
        remoteName: vscode.env.remoteName || null,
        protocolConnected: diagnostics.protocolConnected,
        workspaceUriScheme: vscode.workspace.workspaceFolders[0].uri.scheme,
        snapshotUriScheme: document.uri.scheme,
        evidence: [
          'packaged extension activation',
          'three-way merge report retains human body and reports competing suggestion without publication',
          'command registrations and two knowledge trees',
          'graphical home opens against the host repository and reads three published cards without generation',
          'generation form previews two files and refuses changed forms or replaced plans before backend/model access',
          'completed self-authored Wiki candidate opens its own shared cards without changing canonical knowledge or calling a model',
          'read-only Wiki catalog, article, host-routed evidence and invalid article recovery without publication',
          'read-only knowledge document and validated source navigation',
          'durable draft, dirty-editor rejection and saved candidate diff without publication',
          'bounded user-invoked scan plan preview without model calls',
          'explicit generation command refuses a missing reviewed plan before confirmation/backend access',
          'new-card candidate tree and read-only batch diff; first publish invocation requires review',
          'snapshot editor access',
          'Codex TOML preview',
          'actual standalone MCP diagnostics from extension host',
        ],
        recovery,
        officialCodexAcceptance: 'not tested by this runner',
      },
      null,
      2,
    ),
  );
};
