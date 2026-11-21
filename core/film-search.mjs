import { cleanFilm } from './metadata.mjs';
import { filmId } from './scanner.mjs';

const filmDescription = /\b(film|movie|documentary)\b/i;
const unrelated = /^(list|character|fictional|award|article|soundtrack|book|television series)\b/i;

async function request(endpoint, parameters) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ ...parameters, format: 'json' });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Caribbean/1.1 (personal film library)' },
    signal: AbortSignal.timeout(8000)
  }).catch(() => { throw new Error('Online film search is unavailable.'); });
  if (!response.ok) throw new Error('Online film search is temporarily unavailable.');
  return response.json();
}

export async function searchWikidata(title, limit = 12) {
  const found = await request('https://en.wikipedia.org/w/api.php', {
    action: 'query', generator: 'search', gsrsearch: title + ' film', gsrlimit: '20',
    prop: 'pageprops|pageimages', ppprop: 'wikibase_item', piprop: 'thumbnail',
    pithumbsize: '500', pilicense: 'any', pilimit: 'max'
  });
  const pages = Object.values(found.query?.pages || {}).sort((a, b) => a.index - b.index);
  const ids = pages.map((entry) => entry.pageprops?.wikibase_item).filter(Boolean);
  if (!ids.length) return [];
  const records = await request('https://www.wikidata.org/w/api.php', {
    action: 'wbgetentities', ids: ids.join('|'), languages: 'en', props: 'labels|descriptions|claims'
  });
  const results = [];
  for (const page of pages) {
    const id = page.pageprops?.wikibase_item;
    const entry = records.entities?.[id];
    const description = entry?.descriptions?.en?.value || '';
    const claim = (property) => entry?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
    const imdb = claim('P345');
    if (!imdb || !filmDescription.test(description) || unrelated.test(description)) continue;
    const year = description.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || claim('P577')?.time?.slice(1, 5);
    const duration = claim('P2047');
    const film = cleanFilm({
      title: (entry?.labels?.en?.value || page.title).replace(/\s*\((?:(?:18|19|20)\d{2} )?film\)$/i, ''),
      year, imdb, description,
      poster: page.thumbnail?.height > page.thumbnail?.width ? page.thumbnail.source : '',
      runtime: duration?.unit?.endsWith('/Q7727') ? duration.amount : ''
    });
    if (film.title) results.push({ ...film, id: filmId(film.title, film.year) });
  }
  const name = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const term = name(title.replace(/\s+\(?\d{4}\)?$/, ''));
  const rank = (film) => name(film.title) === term ? 0 : name(film.title).startsWith(term + ' ') ? 1 : 2;
  return results.sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}
