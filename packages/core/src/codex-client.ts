import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

const record = z.record(z.string(), z.unknown());
const methodName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_/-]{0,159}$/u);
export type BackendReason =
  'authentication' | 'network' | 'unsupported' | 'overloaded' | 'unknown';
export class CodexBackendError extends Error {
  constructor(
    readonly code: string,
    readonly phase: string,
    readonly rpcCode: number | null = null,
    readonly reason: BackendReason = 'unknown',
  ) {
    super(`${code}: ${phase}`);
  }
}
const classify = (code: number, message: string): BackendReason => {
  if (code === -32601) return 'unsupported';
  if (code === -32001 || /overload|rate.limit/iu.test(message))
    return 'overloaded';
  if (/auth|login|log.in|credential|token|keyring|unauthorized/iu.test(message))
    return 'authentication';
  if (/network|connect|timed?.out|dns|proxy|tls|certificate/iu.test(message))
    return 'network';
  return 'unknown';
};
interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: CodexBackendError) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface CodexTransportOptions {
  command: string;
  cwd: string;
  args: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

// No shell, login flow, token access, raw protocol logs or implicit retries.
export class CodexStdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly encoder = new TextEncoder();
  private buffer = '';
  private received = 0;
  private stderrBytes = 0;
  private sequence = 0;
  private denials = 0;
  private terminal: CodexBackendError | undefined;
  private initialized = false;
  private termination?: Promise<void>;
  private observer:
    | {
        notification: (method: string, params: unknown) => void;
        failure: (error: CodexBackendError) => void;
      }
    | undefined;
  private readonly timeoutMs: number;
  private readonly abort: () => void;
  private readonly closed: Promise<void>;
  constructor(private readonly options: CodexTransportOptions) {
    if (!isAbsolute(options.command) || !isAbsolute(options.cwd))
      throw new CodexBackendError('INVALID_EXECUTABLE', 'start');
    if (
      options.args.length > 32 ||
      options.args.some((arg) => arg.length > 4096 || arg.includes('\0'))
    )
      throw new CodexBackendError('INVALID_ARGUMENTS', 'start');
    this.timeoutMs = options.timeoutMs ?? 15000;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 60000
    )
      throw new CodexBackendError('INVALID_TIMEOUT', 'start');
    if (options.signal?.aborted)
      throw new CodexBackendError('CANCELLED', 'start');
    this.child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.closed = new Promise((resolve) => this.child.once('close', resolve));
    this.child.on('error', () =>
      this.fail(new CodexBackendError('PROCESS_START_FAILED', 'start')),
    );
    this.child.stdin.on('error', () =>
      this.fail(new CodexBackendError('PROCESS_IO_FAILED', this.phase())),
    );
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > 256 * 1024)
        this.fail(new CodexBackendError('OUTPUT_LIMIT', this.phase()));
    });
    this.child.on('close', () => {
      if (!this.terminal)
        this.fail(new CodexBackendError('PROCESS_EXITED', this.phase()), false);
      options.signal?.removeEventListener('abort', this.abort);
    });
    this.abort = () =>
      this.fail(new CodexBackendError('CANCELLED', this.phase()));
    options.signal?.addEventListener('abort', this.abort, { once: true });
    if (options.signal?.aborted) this.abort();
  }
  private phase(): string {
    return this.pending.values().next().value?.method ?? 'transport';
  }
  private fail(error: CodexBackendError, terminate = true): void {
    if (this.terminal) return;
    this.terminal = error;
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.pending.clear();
    try {
      this.observer?.failure(error);
    } catch {
      /* Teardown must continue even if a consumer throws. */
    }
    if (terminate) {
      this.child.stdin.destroy();
      void this.terminate();
    } else this.child.stdin.end();
  }
  private terminate(): Promise<void> {
    if (this.termination) return this.termination;
    const pid = this.child.pid;
    if (!pid || this.child.exitCode !== null || this.child.signalCode !== null)
      return Promise.resolve();
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot;
      const command = join(
        systemRoot && isAbsolute(systemRoot) ? systemRoot : 'C:\\Windows',
        'System32',
        'taskkill.exe',
      );
      this.termination = new Promise<void>((resolve) => {
        execFile(
          command,
          ['/PID', String(pid), '/T', '/F'],
          { windowsHide: true, timeout: 1000, maxBuffer: 8192 },
          () => {
            this.child.kill('SIGKILL');
            resolve();
          },
        );
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        this.child.kill('SIGKILL');
      }
      this.termination = Promise.resolve();
    }
    return this.termination;
  }
  private send(message: unknown): void {
    if (this.terminal) throw this.terminal;
    const text = JSON.stringify(message) + '\n';
    if (this.encoder.encode(text).length > 256 * 1024)
      throw new CodexBackendError('INPUT_LIMIT', this.phase());
    this.child.stdin.write(text, (error) => {
      if (error)
        this.fail(new CodexBackendError('PROCESS_IO_FAILED', this.phase()));
    });
  }
  private receive(chunk: Buffer): void {
    if (this.terminal) return;
    try {
      this.received += chunk.length;
      if (this.received > 4 * 1024 * 1024)
        throw new CodexBackendError('OUTPUT_LIMIT', this.phase());
      this.buffer += this.decoder.decode(chunk, { stream: true });
      if (this.encoder.encode(this.buffer).length > 1024 * 1024)
        throw new CodexBackendError('MESSAGE_LIMIT', this.phase());
      for (;;) {
        const boundary = this.buffer.indexOf('\n');
        if (boundary < 0) break;
        const line = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 1);
        if (!line.trim()) continue;
        const message = record.parse(JSON.parse(line));
        if (typeof message.method === 'string') {
          methodName.parse(message.method);
          if (message.id !== undefined) {
            if (this.observer)
              throw new CodexBackendError(
                'SERVER_REQUEST_BLOCKED',
                this.phase(),
              );
            if (
              !(
                typeof message.id === 'string' ||
                Number.isSafeInteger(message.id)
              ) ||
              ++this.denials > 32
            )
              throw new CodexBackendError('PROTOCOL_ERROR', this.phase());
            this.send({
              id: message.id,
              error: {
                code: -32601,
                message: 'This client does not handle server requests',
              },
            });
          } else this.observer?.notification(message.method, message.params);
          // Diagnostics have no observer and never retain session data.
          continue;
        }
        if (!Number.isSafeInteger(message.id))
          throw new CodexBackendError('PROTOCOL_ERROR', this.phase());
        const id = message.id as number,
          task = this.pending.get(id);
        if (!task || 'result' in message === 'error' in message)
          throw new CodexBackendError('PROTOCOL_ERROR', this.phase());
        if ('error' in message) {
          const error = z
            .object({ code: z.int(), message: z.string() })
            .parse(message.error);
          this.pending.delete(id);
          clearTimeout(task.timer);
          task.reject(
            new CodexBackendError(
              'RPC_REJECTED',
              task.method,
              error.code,
              classify(error.code, error.message),
            ),
          );
        } else {
          this.pending.delete(id);
          clearTimeout(task.timer);
          task.resolve(message.result);
        }
      }
    } catch (error) {
      this.fail(
        error instanceof CodexBackendError
          ? error
          : new CodexBackendError('PROTOCOL_ERROR', this.phase()),
      );
    }
  }
  async initialize(): Promise<void> {
    if (this.initialized)
      throw new CodexBackendError('ALREADY_INITIALIZED', 'initialize');
    this.initialized = true;
    const result = await this.request('initialize', {
      clientInfo: {
        name: 'repo_knowledge',
        title: 'Repo Knowledge',
        version: '0.1.0',
      },
      capabilities: { experimentalApi: false },
    });
    record.parse(result);
    this.send({ method: 'initialized' });
  }
  observe(
    notification: (method: string, params: unknown) => void,
    failure: (error: CodexBackendError) => void,
  ): () => void {
    if (this.terminal) throw this.terminal;
    if (!this.initialized)
      throw new CodexBackendError('NOT_INITIALIZED', 'observe');
    if (this.observer) throw new CodexBackendError('OBSERVER_BUSY', 'observe');
    const observer = { notification, failure };
    this.observer = observer;
    return () => {
      if (this.observer === observer) this.observer = undefined;
    };
  }
  request(method: string, params: unknown): Promise<unknown> {
    methodName.parse(method);
    if (!this.initialized || this.terminal)
      return Promise.reject(
        this.terminal ?? new CodexBackendError('NOT_INITIALIZED', method),
      );
    if (this.pending.size >= 8)
      return Promise.reject(new CodexBackendError('REQUEST_LIMIT', method));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(
        () => this.fail(new CodexBackendError('REQUEST_TIMEOUT', method)),
        this.timeoutMs,
      );
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.fail(
          error instanceof CodexBackendError
            ? error
            : new CodexBackendError('PROCESS_IO_FAILED', method),
        );
      }
    });
  }
  async close(): Promise<void> {
    this.options.signal?.removeEventListener('abort', this.abort);
    this.fail(new CodexBackendError('CLOSED', this.phase()), false);
    let force: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.closed,
        new Promise<void>((resolve) => {
          force = setTimeout(() => {
            void this.terminate().then(resolve);
          }, 1000);
        }),
      ]);
    } finally {
      if (force) clearTimeout(force);
    }
  }
}

export interface BackendDiagnostic {
  status: 'configured' | 'not-authenticated' | 'unverified';
  checks: {
    initialized: boolean;
    configurationRead: boolean;
    shellToolsDisabled: boolean;
    accountRead: boolean;
  };
  modelConfigured: boolean;
  account: 'present' | 'absent' | 'external' | 'unverified';
  authMode: 'chatgpt' | 'apiKey' | 'amazonBedrock' | 'other' | null;
  error: {
    code: string;
    phase: string;
    rpcCode: number | null;
    reason: BackendReason;
  } | null;
  generationVerified: false;
  modelRequests: 0;
  threadCreated: false;
}
export async function inspectCodexBackend(
  client: CodexStdioClient,
  cwd: string,
): Promise<BackendDiagnostic> {
  const report: BackendDiagnostic = {
    status: 'unverified',
    checks: {
      initialized: false,
      configurationRead: false,
      shellToolsDisabled: false,
      accountRead: false,
    },
    modelConfigured: false,
    account: 'unverified',
    authMode: null,
    error: null,
    generationVerified: false,
    modelRequests: 0,
    threadCreated: false,
  };
  try {
    await client.initialize();
    report.checks.initialized = true;
    const response = z
      .object({ config: record })
      .parse(
        await client.request('config/read', { includeLayers: false, cwd }),
      );
    report.checks.configurationRead = true;
    const features = record.safeParse(response.config.features);
    report.checks.shellToolsDisabled =
      features.success && features.data.shell_tool === false;
    report.modelConfigured =
      typeof response.config.model === 'string' &&
      response.config.model.length > 0;
    if (!report.checks.shellToolsDisabled)
      throw new CodexBackendError('CONFIG_UNCONFIRMED', 'config/read');
    const account = z
      .object({ account: record.nullable(), requiresOpenaiAuth: z.boolean() })
      .parse(await client.request('account/read', { refreshToken: false }));
    report.checks.accountRead = true;
    report.account = account.account
      ? 'present'
      : account.requiresOpenaiAuth
        ? 'absent'
        : 'external';
    const mode = account.account?.type;
    report.authMode = account.account
      ? mode === 'chatgpt' || mode === 'apiKey' || mode === 'amazonBedrock'
        ? mode
        : 'other'
      : null;
    report.status =
      report.account === 'absent' ? 'not-authenticated' : 'configured';
  } catch (error) {
    const failure =
      error instanceof CodexBackendError
        ? error
        : new CodexBackendError('INVALID_RESPONSE', 'diagnostic');
    report.error = {
      code: failure.code,
      phase: failure.phase,
      rpcCode: failure.rpcCode,
      reason: failure.reason,
    };
  } finally {
    await client.close();
  }
  return report;
}
export async function diagnoseCodexBackend(
  command: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<BackendDiagnostic> {
  const client = new CodexStdioClient({
    command,
    cwd,
    args: [
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'features.shell_tool=false',
    ],
    ...(signal ? { signal } : {}),
  });
  return inspectCodexBackend(client, cwd);
}
