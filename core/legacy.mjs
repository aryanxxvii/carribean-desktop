import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, put } from './storage.mjs';
import { parseFilename, filmId } from './scanner.mjs';
import { cleanFilm, withMetadata } from './metadata.mjs';

export async function importLegacy(store, source, { automatic = false } = {}) {
  const config = await readJson(path.join(source, 'settings.json'), null);
  const dataPath = config ? source : path.join(source, 'data');
  const [metadata, watched, watchlist, nestedMetadata] = await Promise.all([
    readJson(path.join(dataPath, 'metadata.json'), null),
    readJson(path.join(dataPath, 'watched.json'), null),
    readJson(path.join(dataPath, 'watchlist.json'), null),
    readJson(path.join(source, 'data', 'metadata.json'), null)
  ]);
  const nested = !metadata && nestedMetadata;
  const oldFilms = metadata || nestedMetadata;
  const history = nested ? await readJson(path.join(source, 'data', 'watched.json'), {}) : watched;
  const saved = nested ? await readJson(path.join(source, 'data', 'watchlist.json'), {}) : watchlist;
  if (!config && !oldFilms && !history && !saved) {
    if (automatic) return 0;
    throw new Error('Choose the old Carribean backend or theatre-data folder.');
  }
  let imported = 0;
  const lookup = new Map();
  const timestamps = { rev: '0000000000001-00000000-0000-4000-8000-000000000000' };
  const legacyRecord = (value) => ({ ...timestamps, value });
  await store.edit((library) => {
    if (automatic && Object.keys(library.films).length) return;
    for (const [key, row] of Object.entries(oldFilms || {})) {
      if (!row || typeof row !== 'object') continue;
      const parsed = parseFilename(path.win32.basename(row.fileName || row.fullPath || key));
      const id = filmId(row.title || parsed.title, row.year || parsed.year);
      const movie = cleanFilm({ ...parsed, ...row, catalogued: true });
      if (!movie.title) continue;
      if (!library.films[id]) library.films[id] = legacyRecord(movie);
      else if (!automatic) {
        const current = library.films[id].value;
        const filled = withMetadata(movie, current);
        if (JSON.stringify(current) !== JSON.stringify(filled)) put(library.films, id, filled);
      }
      lookup.set(key, id);
      if (row.fullPath) lookup.set(row.fullPath, id);
      imported++;
    }
    for (const [key, status] of Object.entries(history || {})) {
      if (!status) continue;
      const parsed = parseFilename(path.win32.basename(key));
      const id = lookup.get(key) || filmId(parsed.title, parsed.year);
      library.films[id] ||= legacyRecord(cleanFilm({ ...parsed, catalogued: true }));
      library.watched[id] ||= legacyRecord(true);
    }
    const entries = Object.entries(saved || {}).filter(([, value]) => value);
    if (!entries.length) return;
    const list = 'list-8161bf5a-62dd-4db8-9b1d-65d9118f1146';
    library.lists[list] ||= legacyRecord({ name: 'Imported watchlist' });
    for (const [key, value] of entries) {
      const sourceKey = typeof value === 'string' ? value : value?.fullPath || key;
      const parsed = parseFilename(path.win32.basename(sourceKey));
      const film = cleanFilm(typeof value === 'object' ? { ...parsed, ...value } : parsed);
      if (!film.title) continue;
      const id = lookup.get(sourceKey) || filmId(film.title, film.year);
      library.films[id] ||= legacyRecord(film);
      library.entries[list + ':' + id] ||= legacyRecord(true);
    }
  });
  if (typeof config?.moviePath === 'string' && path.isAbsolute(config.moviePath)) {
    await store.configure((settings) => { settings.moviePath ||= path.normalize(config.moviePath); });
  }
  return imported;
}

export const newListId = () => 'list-' + randomUUID();
