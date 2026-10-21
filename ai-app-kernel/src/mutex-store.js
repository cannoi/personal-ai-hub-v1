/**
 * JSON file store with mutex + debounce + atomic write.
 * Drop-in improvement over raw writeFile without native better-sqlite3.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function createMutexJsonStore(filePath, { debounceMs = 500 } = {}) {
  let data = null;
  let loading = null;
  let writeTimer = null;
  let chain = Promise.resolve();
  let dirty = false;

  async function load() {
    if (data) return data;
    if (loading) return loading;
    loading = (async () => {
      try {
        data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      } catch {
        data = {};
      }
      loading = null;
      return data;
    })();
    return loading;
  }

  async function flush() {
    if (!dirty || !data) return;
    dirty = false;
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = filePath + '.tmp.' + process.pid;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, filePath);
  }

  function scheduleFlush() {
    dirty = true;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      chain = chain.then(flush).catch(() => {});
    }, debounceMs);
  }

  return {
    async get() {
      return load();
    },
    async update(mutator) {
      const run = async () => {
        const cur = await load();
        const next = (await mutator(cur)) || cur;
        data = next;
        scheduleFlush();
        return data;
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
    async set(next) {
      return this.update(() => next);
    },
    async flushNow() {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      await chain;
      dirty = true;
      await flush();
    }
  };
}
