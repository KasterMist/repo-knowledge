const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

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
  const workbench = extension.exports.workbench;
  const roots = await workbench.cards.getChildren();
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
          'command registrations and two knowledge trees',
          'read-only knowledge document and validated source navigation',
          'durable draft, dirty-editor rejection and saved candidate diff without publication',
          'bounded user-invoked scan plan preview without model calls',
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
