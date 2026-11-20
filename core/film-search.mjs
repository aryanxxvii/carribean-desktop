import { cleanFilm } from './metadata.mjs';
import { filmId } from './scanner.mjs';

const filmDescription = /\b(film|movie|documentary)\b/i;
const unrelated = /^(list|character|fictional|award|article|soundtrack|book|television series)\b/i;

async function request(endpoint, parameters) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ ...parameters, format: 'json' });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Carribean/1.0 (personal film library)' },
    signal: AbortSignal.timeout(8000)
  }).catch(() => { throw new Error('Online film search is unavailable.'); });
  if (!response.ok) throw new Error('Online film search is temporarily unavailable.');
  return response.json();
}

export async function searchWikidata(title) {
  const found = await request('https://en.wikipedia.org/w/api.php', {
    action: 'query', generator: 'search', gsrsearch: title + ' film', gsrlimit: '14', prop: 'pageprops',
    ppprop: 'wikibase_item'
  });
  const pages = Object.values(found.query?.pages || {}).sort((a, b) => a.index - b.index);
  const ids = pages.map((entry) => entry.pageprops?.wikibase_item).filter(Boolean);
  if (!ids.length) return [];
  const records = await request('https://www.wikidata.org/w/api.php', {
    action: 'wbgetentities', ids: ids.join('|'), languages: 'en', props: 'labels|descriptions|claims'
  });
  const results = [];
  for (const id of ids) {
    const entry = records.entities?.[id];
    const description = entry?.descriptions?.en?.value || '';
    const claim = (property) => entry?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
    const imdb = claim('P345');
    if (!imdb || !filmDescription.test(description) || unrelated.test(description)) continue;
    const year = description.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || claim('P577')?.time?.slice(1, 5);
    const duration = claim('P2047');
    const film = cleanFilm({
      title: entry?.labels?.en?.value, year, imdb, description,
      runtime: duration?.unit?.endsWith('/Q7727') ? duration.amount : ''
    });
    if (film.title) results.push({ ...film, id: filmId(film.title, film.year) });
  }
  return results;
}
