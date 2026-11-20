import { useRef, useState } from 'react';
import { Check, Film, Plus, Search, X } from 'lucide-react';
import { call } from './api';
import { Modal, moviePoster } from './components';
import { findFilms, sameFilm } from './library';

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

export function LookupInput({ lookup, autoFocus = false, inputRef, placeholder = 'Search films', buttonText = 'Search' }) {
  return <form className="lookup-form" role="search" onSubmit={(event) => { event.preventDefault(); lookup.submit(); }}>
    <div className="top-search glass">
      <Search size={17} />
      <input ref={inputRef} aria-label="Search films" autoFocus={autoFocus} placeholder={placeholder} value={lookup.query} onChange={(event) => lookup.change(event.target.value)} />
      {lookup.query && <button type="button" aria-label="Clear search" onClick={() => lookup.change('')}><X size={15} /></button>}
    </div>
    <button type="submit" className="button glass secondary" disabled={lookup.query.trim().length < 2 || lookup.working}>
      {lookup.working ? 'Searching…' : buttonText}
    </button>
  </form>;
}

function Result({ film, onPick, selected, action }) {
  const poster = moviePoster(film);
  return <li className="lookup-result" data-art-source>
    <span className="lookup-poster">{poster ? <img src={poster} alt="" loading="lazy" data-glass-art /> : <Film size={19} />}</span>
    <div><strong>{film.title}</strong><small>{[film.year, film.director || film.origin, film.onDisk ? 'On disk' : '', film.runtime ? film.runtime + ' min' : ''].filter(Boolean).join(' · ')}</small></div>
    <button type="button" className={'glass icon-button result-action' + (selected ? ' chosen' : '')}
      aria-pressed={action === 'Add' ? selected : undefined}
      aria-label={(selected ? 'Remove ' : action + ' ') + film.title}
      title={selected ? 'Remove from watchlist' : action} onClick={() => onPick(film, selected)}>
      {selected || action === 'Use' ? <Check size={16} /> : <Plus size={16} />}
    </button>
  </li>;
}

export function LookupResults({ lookup, movies, onPick, isSelected = () => false, action = 'Add' }) {
  const local = findFilms(movies, lookup.query).slice(0, 12);
  const online = (lookup.remote || []).filter((film) => !local.some((entry) => sameFilm(film, entry)));
  const groups = [['In Carribean', local], ['Online', online]];
  return <div className="lookup-results" aria-live="polite">
    {groups.map(([title, list]) => !!list.length && <section key={title} className="lookup-group">
      <h3>{title}</h3>
      <ul>{list.map((film) => <Result key={film.id} film={film} onPick={onPick} selected={isSelected(film)} action={action} />)}</ul>
    </section>)}
    {lookup.error && <p className="form-error" role="alert">{lookup.error}</p>}
    {lookup.remote && !local.length && !online.length && <p className="lookup-status">No films found.</p>}
  </div>;
}

export function FindFilms({ list, movies, savedMovies, onToggle, onManual, onClose }) {
  const lookup = useLookup();
  return <Modal title="Find films" onClose={onClose} className="lookup-dialog">
    <h2>Find films</h2>
    <p className="modal-subtitle">{list.name}</p>
    <LookupInput lookup={lookup} autoFocus />
    <LookupResults lookup={lookup} movies={movies} onPick={onToggle} isSelected={(film) => savedMovies.some((entry) => sameFilm(entry, film))} />
    <button type="button" className="text-action" onClick={onManual}><Plus size={15} />Add by title</button>
  </Modal>;
}
