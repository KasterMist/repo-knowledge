import { Cache } from './cache.js';

// A cache miss is represented by undefined, not an empty string.
export function 读取(cache: Cache, key: string): string {
  return cache.get(key) ?? '未找到';
}
