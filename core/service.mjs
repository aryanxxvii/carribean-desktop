import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createStorage, mergeLibrary, put } from './storage.mjs';
import { filmId, scanDirectory } from './scanner.mjs';
import { cleanFilm, createOmdb, withMetadata } from './metadata.mjs';
import { parseSnapshot, signIn, syncGit, validateGit } from './git.mjs';
import { importLegacy, newListId } from './legacy.mjs';
import { searchWikidata } from './film-search.mjs';

const nameOf = (name) => String(name || '').trim().slice(0, 80);
const validImdb = (value) => /^tt\d{5,16}$/.test(value || '');
const omdbKeys = (settings) => settings.omdb || process.env.OMDB_API_KEYS || '';
const videoId = (value) => /^film-[a-f\d]{24}$/.test(value || '');
const relativeTo = (base, target) => {
  const relative = path.relative(base, target);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function changeMembership(state, { id, list, film, value }) {
  if (!state.lists[list]?.value) throw new Error('Choose an existing watchlist.');
  const fresh = cleanFilm(film);
  const match = fresh.imdb && Object.keys(state.films).find((key) => state.films[key].value.imdb === fresh.imdb);
  const key = match || (videoId(id) && state.films[id] ? id : filmId(fresh.title, fresh.year));
  if (!state.films[key]) {
    if (!fresh.title) throw new Error('Enter a film title.');
    put(state.films, key, fresh);
  }
  put(state.entries, list + ':' + key, value === true);
}

export function openMovieFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', [file], { windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('Windows could not open the movie.')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export function createService({ directory, open = openMovieFile, pickFolder } = {}) {
  const store = createStorage(directory);
  let scanning;
  let syncing;
  let activity = '';
  let errorMessage = '';
  let watcher;
  const searches = new Map();
  const service = {
    async snapshot() {
      const [library, settings] = await Promise.all([store.library(), store.settings()]);
      return {
        films: Object.entries(library.films).map(([id, record]) => ({
          ...record.value, id, watched: library.watched[id]?.value === true, onDisk: !!settings.files[id]?.length
        })),
        lists: Object.entries(library.lists).filter(([, record]) => record.value).map(([id, record]) => ({
          id, ...record.value,
          filmIds: Object.keys(library.entries).filter((key) => key.startsWith(id + ':') && library.entries[key].value)
            .map((key) => key.split(':')[1])
        })),
        device: {
          moviePath: settings.moviePath, connected: settings.connected === true, skipped: settings.skipped || 0,
          lastSync: settings.lastSync || '', git: settings.git, hasOmdb: !!omdbKeys(settings), canBrowse: !!pickFolder
        },
        activity, error: errorMessage
      };
    },
    async scan({ enrich = false } = {}) {
      if (scanning) return scanning.then(() => enrich ? service.scan({ enrich }) : undefined);
      scanning = store.lockScan(async () => {
        const settings = await store.settings();
        if (!settings.moviePath) return;
        let result;
        try {
          result = await scanDirectory(settings.moviePath);
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENODEV', 'EIO'].includes(error.code)) throw error;
          await store.configure((current) => {
            if (current.moviePath === settings.moviePath) {
              current.connected = false;
              current.files = {};
            }
          });
          return;
        }
        const library = await store.library();
        const files = {};
        const discoveries = new Map();
        for (const film of result.files) {
          (files[film.id] ||= []).push(film.fullPath);
          if (!library.films[film.id]?.value.catalogued) discoveries.set(film.id, cleanFilm({ ...film, catalogued: true }));
        }
        for (const paths of Object.values(files)) paths.sort();
        if (discoveries.size) await store.edit((current) => {
          for (const [id, film] of discoveries) {
            const existing = current.films[id];
            current.films[id] = existing
              ? { ...existing, value: { ...existing.value, catalogued: true } }
              : { rev: '0000000000000-00000000-0000-4000-8000-000000000000', value: film };
          }
        });
        if (JSON.stringify(files) !== JSON.stringify(settings.files) || !settings.connected || settings.skipped !== result.skipped) {
          await store.configure((current) => {
            if (current.moviePath === settings.moviePath) {
              current.files = files;
              current.connected = true;
              current.skipped = result.skipped;
            }
          });
        }
        if (!enrich || !omdbKeys(settings)) return;
        const api = createOmdb(omdbKeys(settings));
        const pending = [...new Map(result.files.filter((file) => {
          const data = library.films[file.id]?.value;
          return !data?.poster && !data?.description;
        }).map((file) => [file.id, file])).values()];
        const updates = new Map();
        let metadataError;
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (pending.length && !metadataError) {
            const film = pending.shift();
            try {
              const details = await api.identify(film.title, film.year);
              if (details) updates.set(film.id, details);
            } catch (error) { metadataError = error; }
          }
        }));
        if (updates.size) await store.edit((current) => {
          for (const [id, details] of updates) {
            const film = current.films[id]?.value;
            if (film && !film.poster && !film.description) put(current.films, id, withMetadata(film, details));
          }
        });
        if (metadataError) throw metadataError;
      }).catch((error) => {
        if (error.code !== 'ELOCKED') throw error;
      }).finally(() => { scanning = null; });
      return scanning;
    },
    async sync(startup = false) {
      if (syncing) return syncing;
      errorMessage = '';
      syncing = store.lockSync(async () => {
        activity = 'Scanning your drive';
        let scanError;
        try { await service.scan({ enrich: true }); }
        catch (error) { scanError = error; }
        const { git } = await store.settings();
        if (git.remote && (!startup || git.startup)) {
          activity = 'Syncing with Git';
          const lastSync = await syncGit(store, git);
          await store.configure((settings) => {
            if (settings.git.remote === git.remote && settings.git.branch === git.branch) settings.lastSync = lastSync;
          });
        }
        if (scanError) throw scanError;
      }).catch((error) => {
        errorMessage = error.code === 'ELOCKED' ? 'Carribean is already syncing in another window.' : error.message;
        if (!startup) throw new Error(errorMessage);
      }).finally(() => { syncing = null; activity = ''; });
      return syncing;
    },
    async start() {
      await store.ready;
      const legacy = process.env.APPDATA && path.join(process.env.APPDATA, 'theatre', 'theatre-data');
      if (legacy && !Object.keys((await store.library()).films).length) {
        try { await importLegacy(store, legacy, { automatic: true }); }
        catch { errorMessage = 'The old Carribean library could not be imported.'; }
      }
      void service.sync(true);
      watcher = setInterval(() => service.scan().catch((error) => { errorMessage = error.message; }), 30_000);
      watcher.unref();
    },
    stop() { clearInterval(watcher); },
    async action(action, payload = {}) {
      const id = payload.id;
      switch (action) {
        case 'snapshot': return service.snapshot();
        case 'sync': await service.sync(); break;
        case 'browse': return pickFolder ? await pickFolder(payload.kind) : '';
        case 'configure': {
          const moviePath = String(payload.moviePath || '').trim().replace(/^"|"$/g, '');
          if (moviePath && !path.isAbsolute(moviePath)) throw new Error('Enter an absolute movie-folder path.');
          const canonical = moviePath ? await realpath(moviePath).catch(() => '') : '';
          const folderChanged = path.normalize(moviePath || '.') !== ((await store.settings()).moviePath || '.');
          if (moviePath && folderChanged && (!canonical || !(await stat(canonical)).isDirectory())) {
            throw new Error('The movie folder could not be opened. Check the drive and path.');
          }
          const git = validateGit(payload.git || {});
          await store.configure((settings) => {
            const next = canonical || (moviePath ? path.normalize(moviePath) : '');
            if (settings.moviePath !== next) Object.assign(settings, { moviePath: next, connected: false, files: {} });
            if (settings.git.remote !== git.remote || settings.git.branch !== git.branch) settings.lastSync = '';
            settings.git = git;
            if (payload.omdb || payload.clearOmdb) settings.omdb = String(payload.omdb || '').trim().slice(0, 500);
          });
          if (folderChanged) { await scanning; await service.scan(); }
          break;
        }
        case 'signIn': {
          const { git } = await store.settings();
          await signIn(store.root, git);
          break;
        }
        case 'watched':
          await store.edit((state) => {
            if (!videoId(id) || !state.films[id]) throw new Error('This film is not in your collection.');
            put(state.watched, id, payload.value === true);
          });
          break;
        case 'list': {
          const name = nameOf(payload.name);
          if (!name) throw new Error('Give the watchlist a name.');
          const savedListId = id || newListId();
          await store.edit((state) => {
            if (id && !state.lists[id]?.value) throw new Error('This watchlist is no longer available.');
            put(state.lists, savedListId, { name });
            if (payload.film) changeMembership(state, { id: payload.film.id, film: payload.film, list: savedListId, value: true });
          });
          return { ...await service.snapshot(), savedListId };
        }
        case 'removeList':
          await store.edit((state) => {
            if (state.lists[id]?.value) put(state.lists, id, null);
          });
          break;
        case 'membership':
          await store.edit((state) => changeMembership(state, payload));
          break;
        case 'play': {
          const settings = await store.settings();
          const root = await realpath(settings.moviePath).catch(() => '');
          for (const file of videoId(id) ? settings.files[id] || [] : []) {
            const absolute = await realpath(file).catch(() => '');
            if (root && absolute && relativeTo(root, absolute) && (await stat(absolute).catch(() => null))?.isFile()) {
              await open(absolute);
              return { played: true };
            }
          }
          throw new Error('This movie file is unavailable. Reconnect the drive and sync.');
        }
        case 'search': {
          const query = String(payload.query || '').trim().slice(0, 200);
          if (query.length <= 1) return [];
          const keys = omdbKeys(await store.settings());
          const cacheKey = (keys ? 'omdb:' : 'wikidata:') + query.toLowerCase();
          const cached = searches.get(cacheKey);
          if (cached && cached.expires > Date.now()) return cached.promise;
          const promise = (keys
            ? createOmdb(keys).search(query).catch(() => searchWikidata(query))
            : searchWikidata(query)).catch((error) => { searches.delete(cacheKey); throw error; });
          if (searches.size >= 48) searches.delete(searches.keys().next().value);
          searches.set(cacheKey, { promise, expires: Date.now() + 30 * 60 * 1000 });
          return promise;
        }
        case 'metadata': {
          const { imdb, poster, candidate } = payload;
          if (imdb && !validImdb(imdb)) throw new Error('Enter an IMDb ID such as tt0816692.');
          if (poster && !cleanFilm({ poster }).poster) throw new Error('Use an HTTPS poster URL.');
          const keys = omdbKeys(await store.settings());
          const selected = candidate ? cleanFilm(candidate) : null;
          const details = imdb ? await createOmdb(keys).details(imdb)
            : selected?.imdb && keys ? await createOmdb(keys).details(selected.imdb).catch(() => null) || selected : selected;
          if (imdb && !details) throw new Error('OMDb could not find that IMDb title.');
          await store.edit((state) => {
            if (!videoId(id) || !state.films[id]) throw new Error('This film is not in your collection.');
            put(state.films, id, withMetadata(state.films[id].value, { ...details, ...(poster ? { poster } : {}) }));
          });
          break;
        }
        case 'importLegacy': {
          const source = String(payload.directory || '').trim();
          if (!path.isAbsolute(source)) throw new Error('Choose the old library folder.');
          await readdir(source).catch(() => { throw new Error('The old library folder could not be opened.'); });
          await importLegacy(store, source);
          await service.scan();
          break;
        }
        case 'export': return store.library();
        case 'import':
          await store.edit((state) => mergeLibrary(state, parseSnapshot(JSON.stringify(payload.library))));
          break;
        default: throw new Error('Unknown Carribean action.');
      }
      return service.snapshot();
    }
  };
  return service;
}
