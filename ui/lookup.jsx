import { useRef, useState } from 'react';
import { Check, Film, Search, X } from 'lucide-react';
import { call } from './api';
import { moviePoster } from './components';
import { sameFilm } from './library';

export function useLookup(initial = '') {
  const [query, setQuery] = useState(initial);
  const [remote, setRemote] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(initial);
  const generation = useRef(0);
  function change(text) {
    current.current = text;
    generation.current++;
    setQuery(text);
    setRemote(null);
    setWorking(false);
    setError('');
  }
  async function submit() {
    const term = current.current.trim();
    if (term.length < 2) return;
    const request = ++generation.current;
    setWorking(true);
    setError('');
    try {
      const results = await call('search', { query: term });
      if (request === generation.current) setRemote(results);
    } catch (failure) {
      if (request === generation.current) setError(failure.message);
    } finally {
      if (request === generation.current) setWorking(false);
    }
  }
  return { query, remote, working, error, change, submit };
}

export function LookupInput({ lookup }) {
  return <form className="lookup-form" role="search" onSubmit={(event) => { event.preventDefault(); lookup.submit(); }}>
    <div className="top-search glass">
      <Search size={17} />
      <input aria-label="Search film metadata" placeholder="Search film metadata" value={lookup.query} onChange={(event) => lookup.change(event.target.value)} />
      {lookup.query && <button type="button" aria-label="Clear search" onClick={() => lookup.change('')}><X size={15} /></button>}
    </div>
    <button type="submit" className="button glass secondary" disabled={lookup.query.trim().length < 2 || lookup.working}>
      {lookup.working ? 'Searching…' : 'Search'}
    </button>
  </form>;
}

function Result({ film, onPick }) {
  const poster = moviePoster(film);
  return <li className="lookup-result" data-art-source>
    <span className="lookup-poster"><Film size={19} />{poster && <img key={poster} src={poster} alt="" loading="lazy" data-glass-art
      onError={(event) => { event.currentTarget.hidden = true; }} />}</span>
    <div><strong>{film.title}</strong><small>{[film.year, film.director || film.origin, film.onDisk ? 'On disk' : '', film.runtime ? film.runtime + ' min' : ''].filter(Boolean).join(' · ')}</small></div>
    <button type="button" className="glass icon-button result-action"
      aria-label={'Use metadata for ' + film.title} title="Use metadata" onClick={() => onPick(film)}>
      <Check size={16} />
    </button>
  </li>;
}

export function LookupResults({ lookup, film, onPick }) {
  const online = [...(lookup.remote || [])].sort((a, b) => Number(sameFilm(b, film)) - Number(sameFilm(a, film)));
  return <div className="lookup-results" aria-live="polite">
    {!!online.length && <section className="lookup-group" aria-label="Metadata matches">
      <ul>{online.map((entry) => <Result key={entry.imdb || entry.id} film={entry} onPick={onPick} />)}</ul>
    </section>}
    {lookup.error && <p className="form-error" role="alert">{lookup.error}</p>}
    {lookup.remote && !online.length && <p className="lookup-status">No films found.</p>}
  </div>;
}
