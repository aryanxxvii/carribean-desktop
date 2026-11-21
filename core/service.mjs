import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createStorage, mergeLibrary, put } from './storage.mjs';
import { scanDirectory } from './scanner.mjs';
import { cleanFilm, createOmdb, withMetadata } from './metadata.mjs';
import { parseSnapshot, signIn, syncGit, validateGit } from './git.mjs';
import { importLegacy } from './legacy.mjs';
import { searchWikidata } from './film-search.mjs';
import { createMediaReader, editionBadge } from './media-info.mjs';
import { cachedBackdrop, refreshBackdrops } from './backdrops.mjs';

const validImdb = (value) => /^tt\d{5,16}$/.test(value || '');
const omdbKeys = (settings) => settings.omdb || process.env.OMDB_API_KEYS || '';
const videoId = (value) => /^film-[a-f\d]{24}$/.test(value || '');
const missingMetadata = (film) => !film?.poster || !film.description || !film.imdb;
const relativeTo = (base, target) => {
  const relative = path.relative(base, target);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

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
  let scanSummary = null;
  const searches = new Map();
  const mediaReader = createMediaReader(store);
  let mediaRefresh;

  async function localMovie(id, settings, root) {
    if (!videoId(id)) return null;
    settings ||= await store.settings();
    if (!settings.moviePath || !settings.files[id]?.length) return null;
    root ??= await realpath(settings.moviePath).catch(() => '');
    if (!root) return null;
    for (const file of settings.files[id]) {
      const absolute = await realpath(file).catch(() => '');
      if (!absolute || !relativeTo(root, absolute)) continue;
      const info = await stat(absolute).catch(() => null);
      if (info?.isFile()) return { absolute, info };
    }
    return null;
  }

  async function searchOnline(query, keys) {
    if (!keys) return searchWikidata(query);
    const omdb = await createOmdb(keys).search(query).catch(() => []);
    if (!omdb.length) return searchWikidata(query);
    if (omdb.every((film) => film.poster)) return omdb;
    const wikipedia = await searchWikidata(query).catch(() => []);
    return omdb.map((film) => ({ ...film, poster: film.poster || wikipedia.find((entry) => entry.imdb === film.imdb)?.poster || '' }));
  }

  const service = {
    refreshMedia() {
      if (!mediaRefresh) mediaRefresh = (async () => {
        const settings = await store.settings();
        if (!settings.moviePath || !Object.keys(settings.files).length) return;
        const root = await realpath(settings.moviePath).catch(() => '');
        if (root) await mediaReader.refresh(Object.keys(settings.files), (id) => localMovie(id, settings, root));
      })().finally(() => { mediaRefresh = null; });
      return mediaRefresh;
    },
    async snapshot() {
      const [library, settings, media, backdrops] = await Promise.all([store.library(), store.settings(), store.media(), store.backdrops()]);
      return {
        films: Object.entries(library.films).map(([id, record]) => ({
          ...record.value, id, watched: library.watched[id]?.value === true, onDisk: !!settings.files[id]?.length,
          backdrop: cachedBackdrop({ ...record.value, id }, backdrops) || undefined,
          file: settings.files[id]?.includes(media[id]?.source) ? {
            size: media[id].size, resolution: media[id].resolution, formats: media[id].formats,
            aspect: media[id].aspect, ...editionBadge(media[id]),
            audioFormats: [...new Set((media[id].audio || []).map((track) => track.format).filter(Boolean))]
          } : undefined
        })),
        device: {
          moviePath: settings.moviePath, connected: settings.connected === true, skipped: settings.skipped || 0,
          lastSync: settings.lastSync || '', git: settings.git, hasOmdb: !!omdbKeys(settings), canBrowse: !!pickFolder
        },
        activity, error: errorMessage, scanSummary
      };
    },
    async scan({ enrich = false } = {}) {
      if (scanning) return scanning.enrich || !enrich ? scanning.promise : scanning.promise.then(() => service.scan({ enrich }));
      const promise = store.lockScan(async () => {
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
        const filesChanged = JSON.stringify(files) !== JSON.stringify(settings.files);
        if (filesChanged || !settings.connected || settings.skipped !== result.skipped) {
          await store.configure((current) => {
            if (current.moviePath === settings.moviePath) {
              current.files = files;
              current.connected = true;
              current.skipped = result.skipped;
            }
          });
        }
        if (enrich || filesChanged) void service.refreshMedia().catch(() => {});
        if (!enrich) return;
        scanSummary = { files: Object.keys(files).length, found: Object.keys(files).filter((id) => !settings.files[id]?.length).length,
          missing: Object.keys(settings.files).filter((id) => !files[id]).length, updated: 0 };
        if (!omdbKeys(settings)) return;
        activity = 'Looking up films on OMDb';
        const api = createOmdb(omdbKeys(settings));
        const pending = [...new Map(result.files.filter((file) => {
          const data = library.films[file.id]?.value;
          return missingMetadata(data);
        }).map((file) => [file.id, file])).values()];
        const updates = new Map();
        let metadataError;
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (pending.length && !metadataError) {
            const film = pending.shift();
            try {
              const known = library.films[film.id]?.value;
              const details = known?.imdb ? await api.details(known.imdb) : await api.identify(film.title, film.year);
              if (details) updates.set(film.id, details);
            } catch (error) { metadataError = error; }
          }
        }));
        if (updates.size) await store.edit((current) => {
          for (const [id, details] of updates) {
            const film = current.films[id]?.value;
            if (!film || !missingMetadata(film)) continue;
            const filled = withMetadata(details, { ...film, title: film.imdb ? film.title : details.title });
            if (Object.keys(filled).some((field) => filled[field] !== film[field])) {
              put(current.films, id, filled);
              scanSummary.updated++;
            }
          }
        });
        if (metadataError) throw metadataError;
      }).catch((error) => {
        if (error.code !== 'ELOCKED') throw error;
      }).finally(() => { scanning = null; });
      scanning = { promise, enrich };
      return promise;
    },
    async sync(startup = false) {
      if (syncing) return syncing;
      errorMessage = '';
      scanSummary = null;
      syncing = store.lockSync(async () => {
        activity = 'Scanning your drive';
        let scanError;
        try { await service.scan({ enrich: true }); }
        catch (error) { scanError = error; }
        const { git } = await store.settings();
        if (git.remote && (!startup || git.startup)) {
          activity = 'Syncing with Git';
          try {
            const lastSync = await syncGit(store, git);
            await store.configure((settings) => {
              if (settings.git.remote === git.remote && settings.git.branch === git.branch) settings.lastSync = lastSync;
            });
          } catch (error) { scanError ||= error; }
        }
        if (scanSummary) {
          const [library, settings] = await Promise.all([store.library(), store.settings()]);
          const films = Object.keys(settings.files).filter((id) => settings.files[id]?.length && library.films[id])
            .map((id) => ({ ...library.films[id].value, id }));
          try {
            scanSummary.backdrops = await refreshBackdrops(store, films, (done, total) => {
              activity = `Finding featured artwork · ${done}/${total}`;
            });
          } catch (error) { scanError ||= error; }
        }
        if (scanError) throw scanError;
      }).catch((error) => {
        if (startup && error.code === 'ELOCKED') return;
        errorMessage = error.code === 'ELOCKED' ? 'Caribbean is already syncing in another window.' : error.message;
        if (!startup) throw new Error(errorMessage);
      }).finally(() => { syncing = null; activity = ''; });
      return syncing;
    },
    async start() {
      await store.ready;
      const legacy = process.env.APPDATA && path.join(process.env.APPDATA, 'theatre', 'theatre-data');
      if (legacy && !Object.keys((await store.library()).films).length) {
        try { await importLegacy(store, legacy, { automatic: true }); }
        catch { errorMessage = 'The original Caribbean library could not be imported.'; }
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
          if (folderChanged) { await scanning?.promise; await service.scan(); }
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
        case 'play': {
          const movie = await localMovie(id);
          if (movie) { await open(movie.absolute); return { played: true }; }
          throw new Error('This movie file is unavailable. Reconnect the drive and sync.');
        }
        case 'fileDetails': {
          const movie = await localMovie(id);
          if (!movie) return null;
          const { source, version, ...details } = await mediaReader.details(id, movie);
          return { ...details, ...editionBadge(details) };
        }
        case 'search': {
          const query = String(payload.query || '').trim().slice(0, 200);
          if (query.length <= 1) return [];
          const keys = omdbKeys(await store.settings());
          const cacheKey = (keys ? 'omdb:' : 'wikidata:') + query.toLowerCase();
          const cached = searches.get(cacheKey);
          if (cached && cached.expires > Date.now()) return cached.promise;
          const promise = searchOnline(query, keys).catch((error) => { searches.delete(cacheKey); throw error; });
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
          const match = !imdb && selected?.imdb && keys ? await createOmdb(keys).details(selected.imdb).catch(() => null) : null;
          const details = imdb ? await createOmdb(keys).details(imdb)
            : match ? withMetadata(selected, match) : selected;
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
        default: throw new Error('Unknown Caribbean action.');
      }
      return service.snapshot();
    }
  };
  return service;
}
