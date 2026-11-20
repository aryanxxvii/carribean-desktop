import { filmId } from './scanner.mjs';

const string = (value, limit = 200) => {
  const trimmed = String(typeof value === 'number' || typeof value === 'string' ? value : '').trim();
  return trimmed === 'N/A' ? '' : trimmed.slice(0, limit);
};

export function cleanFilm(film = {}) {
  const poster = string(film.poster ?? film.Poster, 2500);
  const imdb = string(film.imdb ?? film.imdbID, 30);
  return {
    title: string(film.apiTitle || film.Title || film.title),
    year: string(film.apiYear || film.Year || film.year, 20).match(/\b\d{4}\b/)?.[0] || '',
    poster: /^https:\/\//i.test(poster) ? poster : '',
    description: string(film.description || film.plot || film.Plot, 5000),
    director: string(film.director || film.Director),
    genre: string(film.genre || film.Genre),
    runtime: Math.min(2000, Number.parseInt(film.runtime || film.Runtime, 10) || 0),
    rating: Math.max(0, Math.min(10, Number(film.rating || film.imdbRating) || 0)),
    cast: string(film.cast || film.Actors, 500),
    imdb: /^tt\d{5,16}$/.test(imdb) ? imdb : '',
    origin: string(film.origin || film.country || film.Country),
    mood: string(film.mood),
    catalogued: film.catalogued === true
  };
}

export function withMetadata(previous, incoming) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value) merged[key] = value;
  }
  return cleanFilm(merged);
}

export function createOmdb(keys) {
  const tokens = keys.split(',').map((key) => key.trim()).filter(Boolean);
  let next = 0;
  async function request(params) {
    if (!tokens.length) throw new Error('Add an OMDb key in Settings to search the full film catalog.');
    const url = new URL('https://www.omdbapi.com/');
    url.search = new URLSearchParams({ ...params, apikey: tokens[next++ % tokens.length], type: 'movie' });
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {
      throw new Error('Could not reach OMDb.');
    });
    if (!response.ok) throw new Error('OMDb is temporarily unavailable.');
    const result = await response.json();
    if (result.Response === 'True') return result;
    if (/key|limit/i.test(result.Error || '')) throw new Error('OMDb rejected the API key or its daily limit has been reached.');
    return null;
  }
  async function search(title, year = '') {
    const found = await request({ s: title, y: year });
    return (found?.Search || []).map((match) => ({ ...cleanFilm(match), id: filmId(match.Title, match.Year) }));
  }
  async function details(imdb) {
    const match = await request({ i: imdb, plot: 'full' });
    return match ? cleanFilm(match) : null;
  }
  async function identify(title, year) {
    const exact = await request({ t: title, y: year, plot: 'full' });
    if (exact && exact.Director !== 'N/A') return cleanFilm(exact);
    const candidates = await search(title, year);
    for (const candidate of candidates.slice(0, 3)) {
      if (/q&a|interview/i.test(candidate.title)) continue;
      const match = await details(candidate.imdb);
      if (match?.director && match.poster) return match;
    }
    return null;
  }
  return { search, details, identify };
}
