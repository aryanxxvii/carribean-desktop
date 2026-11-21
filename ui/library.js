import { homeFormats, mediaFormats } from './media-formats.js';

export const genreNames = (film) => (film.genre || '').split(',').map((genre) => genre.trim()).filter(Boolean);
export const defaultFilters = { genre: '', edition: '', resolution: '', dynamicRange: '', audio: '', min: 0, max: 600, status: 'all', sort: '', descending: false, group: '', groupOrder: 'name' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const titles = (a, b) => collator.compare(a.title, b.title);
export const activeFilters = (filters) => Object.keys(defaultFilters).some((key) => filters[key] !== defaultFilters[key]);
export const searchKey = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/\p{Mark}/gu, '');
export const sameFilm = (left, right) => left.id === right.id || (left.imdb && right.imdb && left.imdb === right.imdb)
  || (left.year === right.year && searchKey(left.title) === searchKey(right.title));

export function findFilms(films, query) {
  const words = (value) => searchKey(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const term = words(query);
  const tokens = term.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return films.map((film) => {
    const title = words(film.title);
    const fields = words([film.title, film.year, film.director, film.cast, film.genre, film.origin].filter(Boolean).join(' ')).split(' ');
    const matched = tokens.every((token) => fields.some((word) => word.startsWith(token)));
    const rank = title === term || `${title} ${film.year}` === term ? 0 : title.startsWith(term) ? 1
      : tokens.every((token) => title.includes(token)) ? 2 : 3;
    return { matched, rank, film };
  }).filter((item) => item.matched).sort((a, b) => a.rank - b.rank || titles(a.film, b.film)).map((item) => item.film);
}

export function genresIn(films) {
  const counts = new Map();
  for (const film of films) for (const genre of genreNames(film)) counts.set(genre, (counts.get(genre) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([genre]) => genre);
}

export function filterLibrary(catalogue, filters) {
  const formatChecks = [filters.edition, filters.resolution, filters.dynamicRange, filters.audio]
    .filter(Boolean).map((key) => mediaFormats.find(([id]) => id === key)?.[2]).filter(Boolean);
  const filteringRuntime = filters.min > 0 || filters.max < 600;
  const people = (value) => value || '\uffff';
  const by = {
    title: titles,
    director: (a, b) => collator.compare(people(a.director), people(b.director)),
    year: (a, b) => Number(a.year || 0) - Number(b.year || 0),
    runtime: (a, b) => a.runtime - b.runtime,
    rating: (a, b) => a.rating - b.rating
  };
  return catalogue.filter((film) => (!filters.genre || genreNames(film).includes(filters.genre))
    && formatChecks.every((matches) => matches(film.file))
    && (!filteringRuntime || (film.runtime && film.runtime >= filters.min && film.runtime <= filters.max))
    && (filters.status === 'all' || film.watched === (filters.status === 'watched')))
    .sort((a, b) => {
      const comparison = by[filters.sort]?.(a, b) ?? (Number(b.onDisk) - Number(a.onDisk));
      return comparison * (filters.descending ? -1 : 1) || titles(a, b);
    });
}

export function groupLibrary(films, filters) {
  if (!filters.group) return [['Films', films]];
  const groups = new Map();
  for (const film of films) {
    const from = Math.floor(film.runtime / 30) * 30;
    const names = filters.group === 'director' ? [film.director || 'Unknown director']
      : filters.group === 'runtime' ? [from ? from + '–' + (from + 29) + ' min' : film.runtime ? 'Under 30 min' : 'Unknown runtime']
        : filters.group === 'decade' ? [decadeOf(film) ? decadeOf(film) + 's' : 'Unknown year']
        : genreNames(film);
    for (const name of names.length ? names : ['Uncategorized']) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(film);
    }
  }
  return [...groups].sort((a, b) => (filters.groupOrder === 'count' ? b[1].length - a[1].length : 0) || collator.compare(a[0], b[0]));
}

const decadeOf = (film) => Math.floor(Number(film.year || 0) / 10) * 10;

function variation(key, seed) {
  let hash = 2166136261 ^ seed;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

export function programLibrary(films, { seed, recent, hasPoster, hasStill }) {
  const watched = films.filter((film) => film.watched);
  const unwatched = films.filter((film) => !film.watched);
  const genres = new Map(films.map((film) => [film.id, genreNames(film)]));
  const taste = new Map();
  for (const film of watched) {
    for (const genre of genres.get(film.id)) taste.set(genre, (taste.get(genre) || 0) + 1);
  }
  const score = (film, key) => {
    const tags = genres.get(film.id);
    const affinity = tags.reduce((total, genre) => total + (taste.get(genre) || 0), 0) / (Math.max(1, tags.length) * Math.max(1, watched.length));
    return (film.rating || 6) * .42 + affinity * 1.7 + variation(key + film.id, seed) * 2.8;
  };
  const ranked = (items, key) => [...items].sort((a, b) => score(b, key) - score(a, key) || titles(a, b));
  const candidates = films;
  const featured = [];
  const knownGenres = new Set();
  const knownEras = new Set();
  const unseen = candidates.filter((film) => !recent.includes(film.id));
  const alternatives = unseen.length ? unseen : candidates.filter((film) => film.id !== recent[0]);
  const ready = alternatives.filter(hasStill);
  const leadPool = ready.length ? ready : alternatives;
  while (featured.length < Math.min(5, candidates.length)) {
    const available = (featured.length || !leadPool.length ? candidates : leadPool).filter((film) => !featured.includes(film));
    const featureScore = (film) => score(film, 'spotlight') + Number(!film.watched) * .8 + Number(hasStill(film) || !!hasPoster(film)) * .45
      + Number(!knownGenres.has(genres.get(film.id)[0])) * .9 + Number(!knownEras.has(decadeOf(film))) * .65
      - Number(recent.includes(film.id)) * 1.2;
    const next = available.sort((a, b) => featureScore(b) - featureScore(a) || titles(a, b))[0];
    featured.push(next);
    knownGenres.add(genres.get(next.id)[0]);
    knownEras.add(decadeOf(next));
  }

  const shelves = [];
  const shown = new Set(featured.map((film) => film.id));
  function add(name, reason, items, strict = false, mark, suffix) {
    if (!items.length) return;
    const ordered = strict ? items : ranked(items, name);
    const arranged = strict ? ordered : [...ordered.filter((film) => !shown.has(film.id)), ...ordered.filter((film) => shown.has(film.id))];
    arranged.slice(0, 7).forEach((film) => shown.add(film.id));
    shelves.push({ name, reason, movies: arranged, mark, suffix });
  }
  function rotate(groups, key) {
    return groups.filter(([, movies]) => movies.length >= 4)
      .sort(([a], [b]) => variation(key + b, seed) - variation(key + a, seed))[0];
  }
  const genre = rotate(genresIn(films).map((item) => [item, films.filter((film) => genres.get(film.id).includes(item))]), 'genre');
  const decades = [...new Set(films.map(decadeOf).filter(Boolean))];
  const decade = rotate(decades.map((year) => [`From the ${year}s`, films.filter((film) => decadeOf(film) === year)]), 'decade');
  const director = rotate([...new Set(films.map((film) => film.director).filter(Boolean))].map((name) =>
    [name, films.filter((film) => film.director === name)]), 'director');

  const related = (reference) => {
    const tags = genres.get(reference.id);
    return unwatched.filter((film) => {
      if (reference.director && film.director === reference.director) return true;
      const candidateTags = genres.get(film.id);
      if (tags.includes('Animation') !== candidateTags.includes('Animation')) return false;
      const shared = candidateTags.filter((genre) => tags.includes(genre));
      return shared.length >= 2 && shared.length * 2 >= Math.max(tags.length, candidateTags.length);
    });
  };
  const match = rotate(ranked(watched, 'reference').slice(0, 24).map((film) => [film.title, related(film)]), 'related');
  add('Unwatched Picks', '', unwatched);
  for (const key of homeFormats) {
    const [, label, matches, mark, suffix] = mediaFormats.find(([id]) => id === key);
    add(key === 'hdr' ? 'HDR' : label, '', films.filter((film) => matches(film.file)), false, mark, suffix);
  }
  if (match) add(`Because you watched ${match[0]}`, '', match[1]);
  if (genre) add(genre[0], 'Genre spotlight', genre[1]);
  add('Top Rated', 'Highest IMDb ratings in your library', [...films].filter((film) => film.rating)
    .sort((a, b) => b.rating - a.rating || score(b, 'rating') - score(a, 'rating')), true);
  if (seed % 2 && director) add(`Directed by ${director[0]}`, 'In your library', director[1]);
  else if (decade) add(decade[0], 'Decade spotlight', decade[1]);
  add('Under 100 Minutes', 'A shorter watch', films.filter((film) => film.runtime > 0 && film.runtime < 100));
  add('Rewatch', 'Films you’ve already marked watched', watched);
  add('Long Sessions', 'Runs for 140 minutes or more', films.filter((film) => film.runtime >= 140));

  return { featured, shelves };
}
