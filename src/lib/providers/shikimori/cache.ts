import { readFile, writeFile, mkdir, rename, copyFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export async function readCache(
  root: string,
  key: string,
  maxAgeMs: number,
): Promise<{ data: unknown; savedAt: number } | null> {
  try {
    if (maxAgeMs <= 0) return null;
    const value = JSON.parse(await readFile(cachePath(root, key), 'utf8'));
    return Number.isFinite(value.savedAt) && Date.now() - value.savedAt < maxAgeMs ? value : null;
  } catch {
    return null;
  }
}
const cachePath = (root: string, key: string) =>
  `${root}/${createHash('sha256').update(key).digest('hex')}.json`;
export async function atomicJson(file: string, data: unknown, backup = false) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    if (backup) {
      try {
        await copyFile(file, `${file}.previous`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(code || '')) throw error;
        // Windows scanners/watchers can briefly hold a file. Never delete the working target.
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
  } finally {
    await rm(tmp, { force: true });
  }
}
export async function writeCache(root: string, key: string, data: unknown, savedAt = Date.now()) {
  await atomicJson(cachePath(root, key), { savedAt, data });
}
