import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createService } from '../core/service.mjs';
import { parseFilename } from '../core/scanner.mjs';

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

  let view = await first.action('configure', { moviePath: folderA, git });
  assert.equal(view.films.length, 1);
  const { id } = view.films[0];
  await first.action('play', { id });
  assert.equal(playback, await realpath(path.join(folderA, filmName)));
  await first.action('metadata', { id, poster: 'https://images.example.invalid/perfect-blue.jpg' });
  await first.action('watched', { id, value: true });
  view = await first.action('list', { name: 'Friday films' });
  const list = view.lists[0].id;
  await first.action('membership', { id, list, value: true });
  const initial = await first.action('sync');
  assert.ok(initial.device.lastSync);

  await second.action('configure', { moviePath: folderB, git });
  const restored = await second.action('sync');
  assert.equal(restored.films[0].id, id);
  assert.equal(restored.films[0].onDisk, true);
  assert.equal(restored.films[0].watched, true);
  assert.equal(restored.films[0].poster, 'https://images.example.invalid/perfect-blue.jpg');
  assert.deepEqual(restored.lists[0].filmIds, [id]);

  await first.action('list', { id: list, name: 'Weekend films' });
  await second.action('watched', { id, value: false });
  await second.action('membership', { id, list, value: false });
  await first.action('sync');
  const merged = await second.action('sync');
  assert.equal(merged.lists[0].name, 'Weekend films');
  assert.deepEqual(merged.lists[0].filmIds, []);
  assert.equal(merged.films[0].watched, false);

  const snapshot = gitCommand(['--git-dir', remote, 'show', git.branch + ':carribean-library.json']);
  assert.doesNotMatch(snapshot, /First Drive|Second Drive|fullPath|moviePath|omdb|gitconfig/i);
  await rename(folderB, folderB + '-disconnected');
  const offline = await second.action('sync');
  assert.equal(offline.device.connected, false);
  assert.equal(offline.films[0].onDisk, false);
  assert.equal(offline.lists[0].name, 'Weekend films');
});
