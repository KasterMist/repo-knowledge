// Self-authored demo only. No external project is executed.
export class Cache {
  private readonly entries = new Map<string, string>();
  get(key: string): string | undefined {
    return this.entries.get(key);
  }
  put(key: string, value: string): void {
    this.entries.set(key, value);
  }
}
