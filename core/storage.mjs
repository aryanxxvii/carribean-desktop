import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import lockfile from 'proper-lockfile';

export const dataDirectory = process.env.CARRIBEAN_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Carribean', 'Collection');
export const emptyLibrary = () => ({ version: 1, films: {}, watched: {}, lists: {}, entries: {} });
export const groups = ['films', 'watched', 'lists', 'entries'];
export const initialSettings = { moviePath: '', files: {}, git: { remote: '', branch: 'carribean-library', name: '', email: '', startup: true } };

export async function readJson(file, fallback) {
  try {
    return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(file, data) {
  const staged = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(staged, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(staged, file);
  } finally {
    await rm(staged, { force: true });
  }
}

export function mergeLibrary(first, second) {
  const merged = emptyLibrary();
  for (const group of groups) {
    for (const id of [...new Set([...Object.keys(first[group]), ...Object.keys(second[group])])].sort()) {
      const left = first[group][id];
      const right = second[group][id];
      const latest = !left || (right && (right.rev > left.rev ||
        (right.rev === left.rev && JSON.stringify(right.value) > JSON.stringify(left.value)))) ? right : left;
      const catalogued = group === 'films' && (left?.value.catalogued || right?.value.catalogued);
      merged[group][id] = catalogued && !latest.value.catalogued
        ? { ...latest, value: { ...latest.value, catalogued: true } } : latest;
    }
  }
  return merged;
}

export function put(group, id, value) {
  const timestamp = Math.max(Date.now(), Number(group[id]?.rev.split('-')[0] || 0) + 1);
  group[id] = { rev: String(timestamp).padStart(13, '0') + '-' + randomUUID(), value };
}

export function createStorage(root = dataDirectory) {
  const libraryFile = path.join(root, 'library.json');
  const settingsFile = path.join(root, 'device.json');
  const ready = mkdir(root, { recursive: true });
  async function locked(target, task, immediate = false) {
    await ready;
    const release = await lockfile.lock(path.join(root, target), {
      realpath: false, stale: 30000, retries: immediate ? 0 : { retries: 12, minTimeout: 40, maxTimeout: 300 }
    });
    try { return await task(); }
    finally { await release(); }
  }
  const library = async () => readJson(libraryFile, emptyLibrary());
  const settings = async () => {
    const saved = await readJson(settingsFile, {});
    return { ...initialSettings, ...saved, git: { ...initialSettings.git, ...saved.git } };
  };
  return {
    root, library, settings, ready,
    edit: (edit) => locked('library-gate', async () => {
      const current = await library();
      const updated = await edit(current) || current;
      await writeJson(libraryFile, updated);
      return updated;
    }),
    configure: (edit) => locked('settings-gate', async () => {
      const current = await settings();
      await edit(current);
      await writeJson(settingsFile, current);
      return current;
    }),
    lockSync: (task) => locked('sync-gate', task, true),
    lockScan: (task) => locked('scan-gate', task, true)
  };
}
