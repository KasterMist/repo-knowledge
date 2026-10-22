// Repository engineering policy; knowledge contracts live in packages/core.
export function validateManifests(root, workspaces) {
  const errors = [];
  const manifests = [root, ...workspaces];
  const names = workspaces.map((workspace) => workspace.name);
  if (new Set(names).size !== names.length)
    errors.push('Duplicate workspace name');
  for (const manifest of manifests) {
    if (manifest.private !== true)
      errors.push(`${manifest.name}: must be private`);
    if (manifest.license !== 'Apache-2.0')
      errors.push(`${manifest.name}: license mismatch`);
    if (manifest.version !== root.version)
      errors.push(`${manifest.name}: version mismatch`);
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@repo-knowledge/')) {
        if (!names.includes(name))
          errors.push(`${manifest.name}: unknown workspace ${name}`);
        if (version !== root.version)
          errors.push(`${manifest.name}: workspace version mismatch`);
      }
    }
  }
  for (const [name, version] of Object.entries(root.devDependencies ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(version))
      errors.push(`${name}: pin an exact version`);
  }
  const core = workspaces.find(
    (workspace) => workspace.name === '@repo-knowledge/core',
  );
  if (
    core &&
    Object.keys(core.dependencies ?? {}).some((name) => name !== 'zod')
  ) {
    errors.push(
      'core: only runtime schema validation is allowed; keep editor/protocol independent',
    );
  }
  return errors;
}

export function validateWorkflow(workflow) {
  const errors = [];
  const platforms = workflow?.jobs?.check?.strategy?.matrix?.os ?? [];
  for (const os of ['windows-latest', 'ubuntu-latest']) {
    if (!platforms.includes(os))
      errors.push(`Missing required CI platform: ${os}`);
  }
  if (workflow?.permissions?.contents !== 'read')
    errors.push('CI must be read-only');
  if (workflow?.on?.pull_request_target)
    errors.push('Do not execute PR code with privileged events');
  const steps = workflow?.jobs?.check?.steps ?? [];
  if (!steps.some((step) => step.run === 'npm ci'))
    errors.push('CI must use the lockfile');
  if (!steps.some((step) => step.run === 'npm run check'))
    errors.push('CI must run the shared checks');
  for (const step of steps) {
    if (step.uses && !/^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/.test(step.uses)) {
      errors.push('Pin external Actions to full commit SHAs');
    }
  }
  return errors;
}
