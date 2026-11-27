import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createService } from '../core/service.mjs';
import { parseFilename } from '../core/scanner.mjs';
import { createStorage, put } from '../core/storage.mjs';

test('recognizes the old movie filename formats', () => {
  assert.deepEqual(parseFilename('Perfect Blue (1997).mkv'), { title: 'Perfect Blue', year: '1997' });
  assert.deepEqual(parseFilename('Perfect.Blue.1997.1080p.mkv'), { title: 'Perfect Blue', year: '1997' });
  assert.deepEqual(parseFilename('Perfect.Blue.1997.mkv'), { title: 'Perfect Blue', year: '1997' });
});

test('restores a library on a new device, merges edits, and keeps paths local', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'carribean-test-'));
  const localGit = path.join(temp, 'gitconfig');
  const previousGit = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = localGit;
  t.after(async () => {
    if (previousGit === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGit;
    await rm(temp, { force: true, recursive: true });
  });
  const remote = path.join(temp, 'remote');
  const gitCommand = (args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true });
  const git = { remote: 'https://backup.invalid/films.git', branch: 'carribean-library', name: 'Film Tester', email: 'film@example.invalid', startup: true };
  gitCommand(['init', '--bare', '--quiet', remote]);
  gitCommand(['config', '--file', localGit, 'url.' + pathToFileURL(remote).href + '.insteadOf', git.remote]);
  const folderA = path.join(temp, 'First Drive');
  const folderB = path.join(temp, 'Second Drive');
  const filmName = 'Perfect Blue (1997).mkv';
  for (const folder of [folderA, folderB]) {
    await mkdir(folder);
    await writeFile(path.join(folder, filmName), 'test');
  }
  let playback;
  const first = createService({ directory: path.join(temp, 'first'), open: async (file) => { playback = file; } });
  const second = createService({ directory: path.join(temp, 'second') });

  const view = await first.action('configure', { moviePath: folderA, git });
  assert.equal(view.films.length, 1);
  const { id } = view.films[0];
  await first.action('play', { id });
  assert.equal(playback, await realpath(path.join(folderA, filmName)));
  await first.action('metadata', { id, poster: 'https://images.example.invalid/perfect-blue.jpg' });
  await first.action('watched', { id, value: true });
  const list = 'list-8161bf5a-62dd-4db8-9b1d-65d9118f1146';
  const entry = list + ':' + id;
  const oldLibrary = createStorage(path.join(temp, 'first'));
  await oldLibrary.edit((state) => {
    put(state.lists, list, { name: 'Friday films' });
    put(state.entries, entry, true);
  });
  const initial = await first.action('sync');
  assert.ok(initial.device.lastSync);

  await second.action('configure', { moviePath: folderB, git });
  const restored = await second.action('sync');
  assert.equal(restored.films[0].id, id);
  assert.equal(restored.films[0].onDisk, true);
  assert.equal(restored.films[0].watched, true);
  assert.equal(restored.films[0].poster, 'https://images.example.invalid/perfect-blue.jpg');
  assert.equal((await second.action('export')).entries[entry].value, true);

  await oldLibrary.edit((state) => { put(state.lists, list, { name: 'Weekend films' }); });
  await second.action('watched', { id, value: false });
  await first.action('sync');
  const merged = await second.action('sync');
  assert.equal((await second.action('export')).lists[list].value.name, 'Weekend films');
  assert.equal(merged.films[0].watched, false);

  const snapshot = gitCommand(['--git-dir', remote, 'show', git.branch + ':carribean-library.json']);
  assert.doesNotMatch(snapshot, /First Drive|Second Drive|fullPath|moviePath|omdb|gitconfig/i);
  assert.equal(JSON.parse(snapshot).films[id].file.size, 4);
  await rename(folderB, folderB + '-disconnected');
  await assert.rejects(second.action('sync'), /could not scan the entire movie folder/);
  const offline = await second.action('snapshot');
  assert.equal(offline.device.connected, false);
  assert.deepEqual(offline.films, []);
  assert.equal(gitCommand(['--git-dir', remote, 'show', git.branch + ':carribean-library.json']), snapshot);
});
