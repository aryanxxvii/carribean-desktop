import { readFileSync } from 'node:fs';

const site = 'https://www.themoviedb.org';
const cdn = 'https://image.tmdb.org/t/p/w1280/';
const imagePath = /^[a-zA-Z0-9_-]+\.(?:jpg|png|webp)$/i;
const imdbId = /^tt\d{5,16}$/;
const bundled = JSON.parse(readFileSync(new URL('./bundled-backdrops.json', import.meta.url), 'utf8'));
const retryDelay = 86_400_000;
const lookupVersion = 2;
const batchSize = 16;
const parallelism = 3;

function backdropKey(film) {
  if (imdbId.test(film.imdb)) return film.imdb;
  if (film.title && /^\d{4}$/.test(film.year)) return film.id;
  return '';
}

export function cachedBackdrop(film, records) {
  const image = records[backdropKey(film)]?.image;
  return image && imagePath.test(image) ? cdn + image : '';
}

async function page(pathname) {
  const response = await fetch(site + pathname, { signal: AbortSignal.timeout(3500) });
  if (!response.ok) throw new Error('Backdrop source unavailable');
  return response.text();
}

function sameRelease(html, film) {
  if (imdbId.test(film.imdb)) {
    return html.includes('www.imdb.com/title/' + film.imdb + '"') || html.includes('www.imdb.com/title/' + film.imdb + '/');
  }
  const normalize = (title) => title.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const movie = JSON.parse(json);
      if (movie['@type'] === 'Movie' && movie.datePublished?.slice(0, 4) === film.year &&
        typeof movie.name === 'string' && normalize(movie.name) === normalize(film.title)) return true;
    } catch {}
  }
  return false;
}

export function backdropFromPage(html, film) {
  if (!sameRelease(html, film)) return '';
  const match = /<meta property="og:image" content="https:\/\/(?:media\.themoviedb\.org|image\.tmdb\.org)\/t\/p\/(?:w780|w1280)\/([^"]+)"/i.exec(html);
  return match && imagePath.test(match[1]) ? match[1] : '';
}

async function lookup(film) {
  const visited = new Set();
  let unavailable = false;
  // Older releases can have different premiere years by region.
  for (const year of new Set([film.year || '', ''])) {
    const query = new URLSearchParams({ query: film.title, ...(year ? { year } : {}) });
    const html = await page('/search/movie?' + query);
    const candidates = [...new Set(Array.from(html.matchAll(/href="(\/movie\/\d+(?:-[^"?#/]+)?)"/g), ([, url]) => url))].slice(0, 4);
    for (const candidate of candidates) {
      const id = candidate.split('-')[0];
      if (visited.has(id)) continue;
      visited.add(id);
      try {
        const image = backdropFromPage(await page(candidate), film);
        if (image) return image;
      } catch { unavailable = true; }
    }
  }
  if (unavailable) throw new Error('Could not check every backdrop candidate');
  return '';
}

async function lookupMovieIds(batch) {
  const ids = [...new Set(batch.map(([, film]) => film.imdb).filter((id) => imdbId.test(id)))];
  const query = new URL('https://query.wikidata.org/sparql');
  query.searchParams.set('query', `SELECT ?imdb ?tmdb WHERE {
    VALUES ?imdb { ${ids.map((id) => JSON.stringify(id)).join(' ')} }
    ?film wdt:P345 ?imdb ; wdt:P4947 ?tmdb .
  }`);
  const response = await fetch(query, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'Caribbean/1.2 film library' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Movie ID index unavailable');
  const { results } = await response.json();
  const movies = new Map();
  for (const entry of results.bindings) {
    const imdb = entry.imdb?.value;
    const tmdb = entry.tmdb?.value;
    if (ids.includes(imdb) && /^\d+$/.test(tmdb)) movies.set(imdb, tmdb);
  }
  return movies;
}

export async function refreshBackdrops(store, films, onProgress) {
  const records = await store.backdrops();
  const pending = new Map();
  for (const film of films) {
    const key = backdropKey(film);
    if (!key || bundled[film.imdb] || cachedBackdrop(film, records)) continue;
    if (records[key]?.lookupVersion === lookupVersion && records[key].retryAfter > Date.now()) continue;
    if (!pending.has(key)) pending.set(key, film);
  }
  const jobs = [...pending];
  let done = 0;
  let deferred = 0;
  let added = 0;
  if (jobs.length) onProgress(0, jobs.length);
  for (let offset = 0; offset < jobs.length; offset += batchSize) {
    const batch = jobs.slice(offset, offset + batchSize);
    const updates = {};
    let indexed;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(batch.length, parallelism) }, async () => {
      while (next < batch.length) {
        const [key, film] = batch[next++];
        try {
          let searchError;
          let image = await lookup(film).catch((error) => { searchError = error; return ''; });
          if (!image && imdbId.test(film.imdb)) {
            indexed ||= lookupMovieIds(batch);
            const tmdb = (await indexed).get(film.imdb);
            if (tmdb) image = backdropFromPage(await page('/movie/' + tmdb), film);
          }
          if (!image && searchError) throw searchError;
          updates[key] = { image, lookupVersion, retryAfter: Date.now() + retryDelay };
          if (image) added++;
        } catch { deferred++; }
        onProgress(++done, jobs.length);
      }
    }));
    if (Object.keys(updates).length) {
      await store.updateBackdrops(updates);
      Object.assign(records, updates);
    }
  }
  return { total: films.length, ready: films.filter((film) => bundled[film.imdb] || cachedBackdrop(film, records)).length, added, deferred };
}
