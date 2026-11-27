import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { cleanFilm } from './metadata.mjs';
import { emptyLibrary, groups, mergeLibrary } from './storage.mjs';

const snapshotPath = 'carribean-library.json';
const filmKey = /^film-[a-f\d]{24}$/;
const listKey = /^list-[a-f\d-]{36}$/;
const entryKey = /^list-[a-f\d-]{36}:film-[a-f\d]{24}$/;

export function parseSnapshot(text) {
  const data = JSON.parse(text);
  if (data?.version !== 1) throw new Error('The Git branch contains an unsupported Carribean library.');
  const result = emptyLibrary();
  for (const group of groups) {
    if (!data[group] || Array.isArray(data[group]) || typeof data[group] !== 'object') {
      throw new Error('The Git branch contains an invalid Carribean library.');
    }
    const key = group === 'lists' ? listKey : group === 'entries' ? entryKey : filmKey;
    for (const [id, item] of Object.entries(data[group])) {
      if (!key.test(id) || !/^\d{13}-[a-f\d-]{36}$/.test(item?.rev)) {
        throw new Error('The Git branch contains an invalid Carribean record.');
      }
      const value = item.value;
      if (group === 'films' && value && typeof value === 'object' && cleanFilm(value).title) {
        result.films[id] = { rev: item.rev, value: cleanFilm(value) };
      } else if (group === 'lists' && value === null) {
        result.lists[id] = { rev: item.rev, value };
      } else if (group === 'lists' && typeof value?.name === 'string' && value.name.trim()) {
        result.lists[id] = { rev: item.rev, value: { name: value.name.slice(0, 80) } };
      } else if ((group === 'watched' || group === 'entries') && typeof value === 'boolean') {
        result[group][id] = { rev: item.rev, value };
      } else throw new Error('The Git branch contains an invalid Carribean record.');
    }
  }
  return result;
}

export function validateGit(input) {
  const remote = String(input.remote || '').trim();
  if (remote) {
    let url;
    try { url = new URL(remote); } catch {}
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname === '/') {
      throw new Error('Use an HTTPS repository URL without embedded credentials.');
    }
  }
  const branch = String(input.branch || 'carribean-library').trim();
  if (!/^[a-z\d][a-z\d_/-]{0,99}$/i.test(branch) || branch.includes('//') || branch.endsWith('/')) {
    throw new Error('Use a Git branch name containing letters, numbers, slashes, underscores or hyphens.');
  }
  const name = String(input.name || '').trim().slice(0, 100);
  const email = String(input.email || '').trim().slice(0, 150);
  if (remote && (!name || !/^[^\s<>]+@[^\s<>]+$/.test(email))) {
    throw new Error('Enter your Git author name and email address.');
  }
  return { remote, branch, name, email, startup: input.startup !== false };
}

function git(args, { directory, input, environment, interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: directory, windowsHide: true, timeout: interactive ? 120000 : 25000,
      env: {
        ...process.env, GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: interactive ? 'always' : 'never',
        ...environment
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const out = [];
    const err = [];
    let size = 0;
    let failed = false;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        failed = true;
        child.kill();
        reject(new Error('The Git library snapshot exceeds 16 MB.'));
      } else out.push(chunk);
    });
    child.stderr.on('data', (chunk) => { if (err.length < 16) err.push(chunk); });
    child.stdin.on('error', () => {});
    child.on('error', (error) => reject(new Error(error.code === 'ENOENT' ? 'Install Git for Windows to use Git sync.' : 'Git could not start.')));
    child.on('close', (code) => {
      if (!failed) resolve({ code, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

function fail(result, fallback) {
  if (!result.code && result.code !== null) return result.out;
  const reason = /auth|terminal prompts|username|credential|403|repository not found/i.test(result.err)
    ? 'Git could not access the repository. Check the URL and use Sign in to Git.'
    : /resolve host|connect|timed out|network|schannel|ssl/i.test(result.err)
      ? 'Git could not reach the repository.'
      : fallback;
  throw new Error(reason);
}

export async function signIn(root, config) {
  if (!config.remote) throw new Error('Save a Git repository first.');
  const options = { directory: root, interactive: true };
  const credentials = fail(await git(['credential', 'fill'], { ...options, input: 'url=' + config.remote + '\n\n' }),
    'Git sign-in did not complete. Check that Git Credential Manager is installed.');
  fail(await git(['credential', 'approve'], { ...options, input: credentials.trimEnd() + '\n\n' }),
    'Git Credential Manager could not save the sign-in.');
}

export async function syncGit(store, config, reconcile) {
  if (!config.remote) return null;
  const directory = path.join(store.root, 'git-backup');
  await mkdir(directory, { recursive: true });
  const index = await mkdtemp(path.join(store.root, 'git-index-'));
  const environment = {
    GIT_INDEX_FILE: path.join(index, 'index'),
    GIT_AUTHOR_NAME: config.name, GIT_AUTHOR_EMAIL: config.email,
    GIT_COMMITTER_NAME: config.name, GIT_COMMITTER_EMAIL: config.email
  };
  const run = (args, input) => git(args, { directory, environment, input });
  const checked = async (args, input) => fail(await run(args, input), 'Git could not update the Carribean snapshot.').trim();
  const ref = 'refs/heads/' + config.branch;
  try {
    await checked(['init', '--bare', '--quiet']);
    for (let attempt = 0; attempt < 3; attempt++) {
      const refs = await checked(['ls-remote', '--refs', '--', config.remote, ref]);
      let parent = '';
      let remote = emptyLibrary();
      let remoteJson = remote;
      if (refs) {
        await checked(['fetch', '--no-tags', '--depth=1', '--', config.remote, ref]);
        parent = await checked(['rev-parse', 'FETCH_HEAD']);
        const found = await checked(['ls-tree', parent, '--', snapshotPath]);
        if (found) {
          if (!/^100644 blob [a-f\d]+\t/.test(found)) throw new Error('The remote snapshot is not a regular Git file.');
          const snapshot = await checked(['show', parent + ':' + snapshotPath]);
          remoteJson = JSON.parse(snapshot);
          remote = parseSnapshot(snapshot);
        }
      }
      const merged = await store.edit((state) => reconcile(mergeLibrary(state, remote)));
      if (JSON.stringify(merged) !== JSON.stringify(remoteJson)) {
        const blob = await checked(['hash-object', '-w', '--stdin'], JSON.stringify(merged, null, 2) + '\n');
        await checked(parent ? ['read-tree', parent] : ['read-tree', '--empty']);
        await checked(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + snapshotPath]);
        const tree = await checked(['write-tree']);
        const commit = await checked(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'Sync Carribean library']);
        const pushed = await run(['push', '--porcelain', '--', config.remote, commit + ':' + ref]);
        if (/\[rejected\]|\[remote rejected\].*(?:cannot lock ref|reference already exists)/i.test(pushed.out) && pushed.code) continue;
        fail(pushed, 'Git rejected the backup. Check your branch permissions.');
      }
      return new Date().toISOString();
    }
    throw new Error('The Git branch changed during sync. Try syncing again.');
  } finally {
    await rm(index, { force: true, recursive: true });
  }
}
