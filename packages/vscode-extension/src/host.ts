import { posix, win32 } from 'node:path';

export interface HostUri {
  scheme: string;
  authority: string;
  fsPath: string;
}
export interface HostInput {
  remoteName: string | undefined;
  platform: string;
  folder: HostUri;
  extension: HostUri;
  storage: HostUri;
  configuredStore: string;
}
// URI routing belongs to VS Code; native paths belong to the extension host.
export function resolveHost(input: HostInput) {
  const remote = input.remoteName === 'ssh-remote';
  if (input.remoteName && !remote)
    throw new Error(
      'This preview supports native workspaces and Remote SSH to Linux; other remote hosts need separate acceptance.',
    );
  if (remote && input.platform !== 'linux')
    throw new Error('Remote SSH preview requires a Linux extension host.');
  const path = input.platform === 'win32' ? win32 : posix;
  const remoteAuthorities = new Set<string>();
  for (const [role, uri] of Object.entries({
    folder: input.folder,
    extension: input.extension,
    storage: input.storage,
  })) {
    if (uri.scheme === 'vscode-remote') {
      if (!remote || !uri.authority.startsWith('ssh-remote+'))
        throw new Error(
          'Install Repo Knowledge on the SSH host before accessing a remote workspace.',
        );
      remoteAuthorities.add(uri.authority);
    } else if (
      uri.scheme !== 'file' &&
      !(role === 'storage' && uri.scheme === 'vscode-userdata')
    )
      throw new Error('Virtual workspace/storage URIs are not supported.');
    if (!path.isAbsolute(uri.fsPath))
      throw new Error('Extension-host paths must be absolute.');
  }
  if (remoteAuthorities.size > 1)
    throw new Error(
      'Workspace and extension storage belong to different SSH hosts.',
    );
  const authority = [...remoteAuthorities][0];
  if (remote && !authority)
    throw new Error(
      'Cannot identify the SSH authority for editor file routing.',
    );
  if (input.configuredStore && !path.isAbsolute(input.configuredStore))
    throw new Error('storeDirectory must be absolute on the extension host.');
  if (remote && /^[a-z]:[\\/]/iu.test(input.configuredStore))
    throw new Error(
      'Use a Linux storeDirectory on the SSH host, not a Windows client path.',
    );
  return {
    kind: remote ? ('ssh-remote' as const) : ('native' as const),
    authority: authority ?? '',
    repository: input.folder.fsPath,
    extension: input.extension.fsPath,
    storage: input.storage.fsPath,
    configuredStore: input.configuredStore,
  };
}
export function codexConfiguration(
  command: string,
  server: string,
  repository: string,
  store: string,
): string {
  return [
    '[mcp_servers.repo_knowledge]',
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify([server, '--repository', repository, '--store', store])}`,
    'startup_timeout_sec = 15',
    'tool_timeout_sec = 30',
    '',
  ].join('\n');
}

export function nodeCommand(
  configured: string,
  remote: boolean,
  executable: string,
): string {
  if (!configured.trim()) throw new Error('nodeExecutable cannot be empty.');
  if (remote && /^[a-z]:[\\/]/iu.test(configured))
    throw new Error(
      'Configure nodeExecutable for the Linux SSH host, not the Windows client.',
    );
  // Remote extension hosts already run a real Node binary; no remote npm/system install is needed.
  return remote && configured === 'node' ? executable : configured;
}
