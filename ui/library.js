export const genreNames = (film) => (film.genre || '').split(',').map((genre) => genre.trim()).filter(Boolean);
export const defaultFilters = { genre: '', min: 0, max: 600, status: 'all', sort: '', descending: false, group: '', groupOrder: 'name' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const titles = (a, b) => collator.compare(a.title, b.title);
const featuredPosters = ['tt15239678', 'tt1856101', 'tt0156887', 'tt13238346', 'tt6751668', 'tt2543164',
  'tt19770238', 'tt0468569', 'tt0482571', 'tt5013056', 'tt0079944'];
export const activeFilters = (filters) => Object.keys(defaultFilters).some((key) => filters[key] !== defaultFilters[key]);
export const searchKey = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/\p{Mark}/gu, '');
export const sameFilm = (left, right) => left.id === right.id || (left.imdb && right.imdb && left.imdb === right.imdb)
  || (left.year === right.year && searchKey(left.title) === searchKey(right.title));

export function findFilms(films, query) {
  const tokens = searchKey(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return films.map((film) => {
    const title = searchKey(film.title);
    const fields = searchKey([film.title, film.director, film.cast, film.year, film.genre, film.origin, film.description].filter(Boolean).join(' '));
    const matched = tokens.every((token) => fields.includes(token));
    const rank = title === searchKey(query.trim()) ? 0 : tokens.every((token) => title.includes(token)) ? 1 : 2;
    return { matched, rank, film };
  }).filter((item) => item.matched).sort((a, b) => a.rank - b.rank || titles(a.film, b.film)).map((item) => item.film);
}

export function genresIn(films) {
  const counts = new Map();
  for (const film of films) for (const genre of genreNames(film)) counts.set(genre, (counts.get(genre) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([genre]) => genre);
}

export function filterLibrary(catalogue, filters) {
  const filteringRuntime = filters.min > 0 || filters.max < 600;
  const posterRank = (film) => {
    const index = featuredPosters.indexOf(film.imdb);
    return index < 0 ? featuredPosters.length : index;
  };
  const people = (value) => value || '\uffff';
  const by = {
    title: titles,
    director: (a, b) => collator.compare(people(a.director), people(b.director)),
    year: (a, b) => Number(a.year || 0) - Number(b.year || 0),
    runtime: (a, b) => a.runtime - b.runtime,
    rating: (a, b) => a.rating - b.rating
  };
  return catalogue.filter((film) => (!filters.genre || genreNames(film).includes(filters.genre))
    && (!filteringRuntime || (film.runtime && film.runtime >= filters.min && film.runtime <= filters.max))
    && (filters.status === 'all' || film.watched === (filters.status === 'watched')))
    .sort((a, b) => {
      const comparison = by[filters.sort]?.(a, b) ?? (Number(b.onDisk) - Number(a.onDisk) || posterRank(a) - posterRank(b));
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
        : genreNames(film);
    for (const name of names.length ? names : ['Uncategorized']) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(film);
    }
  }
  return [...groups].sort((a, b) => (filters.groupOrder === 'count' ? b[1].length - a[1].length : 0) || collator.compare(a[0], b[0]));
}

export function shelvesFor(films, genres) {
  const byRating = [...films].filter((film) => film.rating).sort((a, b) => b.rating - a.rating || titles(a, b));
  const shelves = [
    ['Unwatched Picks', films.filter((film) => !film.watched)],
    ['Top Rated', byRating],
    ['Short and Tight', films.filter((film) => film.runtime > 0 && film.runtime <= 100)],
    ['Rewatch', films.filter((film) => film.watched)],
    ['Long Sessions', films.filter((film) => film.runtime >= 140)],
    ...genres.slice(0, 3).map((genre) => [genre, films.filter((film) => genreNames(film).includes(genre))])
  ];
  return shelves.filter(([, items]) => items.length);
}
