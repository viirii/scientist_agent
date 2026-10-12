import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
// Whole-state atomic replacement for the single-process MVP. The service serializes mutations.
export class FileStore {
  constructor(path) { this.path = path; }
  async load() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, pairs: [] }; throw error; }
  }
  async save(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, this.path);
  }
}
export class MemoryStore {
  state = { schemaVersion: 1, pairs: [] };
  async load() { return structuredClone(this.state); }
  async save(state) { this.state = structuredClone(state); }
}
