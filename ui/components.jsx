import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleAlert,
  Film, Layers3, Play, Search, Shuffle, Star, X
} from 'lucide-react';
import { asset } from './api';
import { activeFilters, genreNames } from './library';
import { FormatMark } from './format-mark';
import { formatGroups } from './media-formats';
import posterCache from './posters.json';
import discovery from './discovery.json';
import backdrops from '../core/bundled-backdrops.json';

const filmBackdrop = (film) => asset(backdrops[film.imdb]) || film.backdrop;
export const hasStill = (film) => !!filmBackdrop(film);
const discoveryPosters = new Map(discovery.map((film) => [film.imdb, film.poster]));
export const moviePoster = (film) => {
  const cached = posterCache[film.imdb];
  if (cached && cached.source === film.poster) return asset(cached.file);
  const recommendation = discoveryPosters.get(film.imdb);
  if (recommendation && (!film.poster || /^https:\/\/afterlight-watchlist\.aryanwdn\.chatgpt\.site\/posters\//.test(film.poster))) return asset(recommendation);
  return asset(film.poster);
};
export const prettyNumber = (number) => number.toLocaleString();
export function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let size = bytes;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit++;
  }
  return size.toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 }) + ' ' + units[unit];
}
export const movieFacts = (film) => [film.year, film.runtime ? film.runtime + ' min' : '', genreNames(film).slice(0, 2).join(' · ') || film.mood].filter(Boolean);
export const shortDescription = (film) => film.imdb === 'tt0816692'
  ? 'With Earth dying, a pilot leads a team through a wormhole in search of a new home for humanity.'
  : film.description;

export function IconButton({ icon: Icon, label, className = '', children, ...props }) {
  return <button type="button" className={'glass icon-button ' + className} title={label} aria-label={label} {...props}>
    {Icon && <Icon size={18} strokeWidth={1.8} />}{children}
  </button>;
}

const preparedArtwork = new Map();
const artworkCors = (url) => /^https:\/\/image\.tmdb\.org\//i.test(url) ? 'anonymous' : undefined;

async function decodeArtwork(url) {
  if (!url) return '';
  const image = new Image();
  const cors = artworkCors(url);
  if (cors) image.crossOrigin = cors;
  image.src = url;
  let timer;
  try {
    const decoded = await Promise.race([image.decode().then(() => true), new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), 3000);
    })]);
    return decoded ? url : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function prepareArtwork(film) {
  const key = [film.id, film.imdb, film.poster, film.backdrop].join('|');
  if (preparedArtwork.has(key)) return preparedArtwork.get(key);
  if (preparedArtwork.size >= 32) preparedArtwork.delete(preparedArtwork.keys().next().value);
  const task = (async () => {
    const landscape = await decodeArtwork(filmBackdrop(film));
    if (landscape) return { src: landscape, portrait: false };
    return { src: await decodeArtwork(moviePoster(film)), portrait: true };
  })();
  preparedArtwork.set(key, task);
  return task;
}

export function Spotlight({ film: selected, movies, onMove, onSet, onDetails, onPlay }) {
  const [slide, setSlide] = useState(null);
  const film = slide && (movies.find((movie) => movie.id === slide.film.id) || slide.film);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void prepareArtwork(selected).then((artwork) => { if (active) setSlide({ film: selected, artwork }); });
    return () => { active = false; };
  }, [selected?.id, selected?.imdb, selected?.poster, selected?.backdrop]);
  useEffect(() => {
    const index = movies.findIndex((movie) => movie.id === film?.id);
    if (index < 0 || movies.length < 2) return;
    for (const step of [1, -1]) void prepareArtwork(movies[(index + step + movies.length) % movies.length]);
  }, [film?.id, movies]);
  if (!slide) return <section className="spotlight spotlight-loading" aria-label="Featured films" aria-busy="true" />;
  if (!film) return null;
  const position = movies.findIndex((movie) => movie.id === film.id);
  const pending = film.id !== selected?.id;
  return <section className="spotlight" data-art-source aria-label="Featured film" aria-busy={pending}>
    <div className="spotlight-images" aria-hidden="true">
      <div key={film.id} className={'spotlight-art' + (slide.artwork.portrait ? ' portrait-art' : '')} data-current="true">
        {slide.artwork.src && <img className="spotlight-image" crossOrigin={artworkCors(slide.artwork.src)}
          src={slide.artwork.src} alt="" data-glass-art />}
      </div>
    </div>
    <div className="spotlight-shade" />
    <div className="spotlight-copy">
      <div className="spotlight-caption" key={film.id}>
        <span className="feature-label">Featured {position >= 0 && <span className="feature-position">· {position + 1} of {movies.length}</span>}</span>
        <h2>{film.title}</h2>
        <div className="spotlight-facts">
          {movieFacts(film).map((fact) => <span key={fact}>{fact}</span>)}
          {!!film.rating && <span className="feature-score"><Star size={14} fill="currentColor" />{film.rating.toFixed(1)}</span>}
        </div>
        {shortDescription(film) && <p>{shortDescription(film)}</p>}
      </div>
      <div className="spotlight-actions">
        <button className="button glass primary" onClick={() => onPlay(film)}><Play size={15} fill="currentColor" />Play film</button>
        <button className="button glass secondary" onClick={() => onDetails(film)}>Film details</button>
      </div>
    </div>
    {movies.length > 1 && <div className="spotlight-controls">
      <div className="pagination glass" aria-label="Choose a featured film">
        {movies.map((movie, index) => <button className={position === index ? 'current' : ''} key={movie.id}
          aria-label={movie.title} aria-current={position === index ? 'true' : undefined} onClick={() => onSet(index)} />)}
      </div>
      <div className="spotlight-arrows">
        <IconButton icon={ChevronLeft} label="Previous featured film" onClick={() => onMove(-1)} />
        <IconButton icon={ChevronRight} label="Next featured film" onClick={() => onMove(1)} />
      </div>
    </div>}
  </section>;
}

export function Card({ film, onDetails, onWatched }) {
  const image = moviePoster(film);
  return <article className="movie-card">
    <div className="poster-box" data-art-source>
      <button className="poster-action" aria-label={'Details for ' + film.title} onClick={() => onDetails(film)}>
        <span className="no-poster"><Film size={26} strokeWidth={1.2} /><span>{film.title}</span></span>
        {image && <img key={image} src={image} alt="" loading="lazy" decoding="async" data-glass-art onError={(event) => { event.currentTarget.hidden = true; }} />}
      </button>
      {film.rating > 0 && <span className="poster-rating glass"><Star size={12} fill="currentColor" />{film.rating.toFixed(1)}</span>}
      <IconButton icon={film.watched ? Check : Circle} className='poster-seen watch-toggle'
        label={(film.watched ? 'Mark unwatched ' : 'Mark watched ') + film.title} aria-pressed={!!film.watched} onClick={() => onWatched(film)} />
    </div>
    <button className="movie-name" onClick={() => onDetails(film)} title={film.title}>{film.title}</button>
    <div className="movie-facts">
      {film.year && <span>{film.year}</span>}
      {(film.runtime > 0 || film.origin) && <><span className="fact-dot" /><span>{film.runtime ? film.runtime + ' min' : film.origin}</span></>}
    </div>
  </article>;
}

function FilmRow({ film, onDetails, onPlay, onWatched }) {
  const image = moviePoster(film);
  const genres = genreNames(film).slice(0, 2).join(' · ') || film.origin;
  return <li className="film-row">
    <button className="row-film" type="button" onClick={() => onDetails(film)}>
      <span className="row-poster"><Film size={17} />{image && <img key={image} src={image} alt="" loading="lazy"
        onError={(event) => { event.currentTarget.hidden = true; }} />}</span>
      <span className="row-title"><strong>{film.title}</strong>
        <small>{[film.year, film.runtime ? film.runtime + ' min' : '', film.file?.resolution, fileSize(film.file?.size)].filter(Boolean).join(' · ')}</small>
      </span>
    </button>
    <span className="row-credits"><span>{film.director || '—'}</span>{genres && <small>{genres}</small>}</span>
    <span className="row-rating">{film.rating > 0 ? <><Star size={13} fill="currentColor" />{film.rating.toFixed(1)}</> : '—'}</span>
    <div className="row-actions">
      <IconButton icon={Play} label={'Play ' + film.title} onClick={() => onPlay(film)} />
      <IconButton icon={film.watched ? Check : Circle} className="watch-toggle" label={(film.watched ? 'Mark unwatched ' : 'Mark watched ') + film.title}
        aria-pressed={!!film.watched} onClick={() => onWatched(film)} />
    </div>
  </li>;
}

export function MovieGrid({ movies, listMode, ...props }) {
  if (listMode) return <div className="film-table">
    <div className="film-row row-head" aria-hidden="true"><span>Film</span><span className="row-credits">Director / Genre</span><span className="row-rating">IMDb</span><span /></div>
    <ul className="film-rows">{movies.map((film) => <FilmRow key={film.id} film={film} {...props} />)}</ul>
  </div>;
  return <div className="movie-grid">
    {movies.map((film) => <Card key={film.id} film={film} {...props} />)}
  </div>;
}

export function ScrollContinuation({ page, onLoad }) {
  const marker = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      onLoad();
    }, { rootMargin: '0px 0px 360px 0px' });
    observer.observe(marker.current);
    return () => observer.disconnect();
  }, [page, onLoad]);
  return <div ref={marker} className="scroll-continuation" aria-hidden="true" />;
}

export function Shelf({ title, reason, movies, mark, suffix, ...props }) {
  const track = useRef(null);
  const [visible, setVisible] = useState(16);
  const [ends, setEnds] = useState([true, false]);
  const hasMore = visible < movies.length;
  useEffect(() => {
    const node = track.current;
    function measure() {
      const remaining = node.scrollWidth - node.clientWidth - node.scrollLeft;
      if (node.clientWidth && hasMore && remaining < node.clientWidth * .65) {
        setVisible((current) => Math.max(current, Math.min(visible + 12, movies.length)));
      }
      const values = [node.scrollLeft < 3, !hasMore && remaining < 3];
      setEnds((current) => current[0] === values[0] && current[1] === values[1] ? current : values);
    }
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    return () => { resize.disconnect(); node.removeEventListener('scroll', measure); };
  }, [movies.length, hasMore, visible]);
  function scroll(direction) {
    const trackWidth = track.current.clientWidth;
    track.current.scrollBy({ left: direction * Math.max(160, trackWidth * .83), behavior: 'smooth' });
  }
  return <section className="film-shelf" aria-label={title}>
    <div className="shelf-heading">
      <div><h2 className="shelf-title"><FormatMark label={title} mark={mark} suffix={suffix} /></h2>{reason && <p className="shelf-reason">{reason}</p>}</div>
      <div className="shelf-arrows">
        <IconButton icon={ChevronLeft} label={'Previous in ' + title} disabled={ends[0]} onClick={() => scroll(-1)} />
        <IconButton icon={ChevronRight} label={'Next in ' + title} disabled={ends[1]} onClick={() => scroll(1)} />
      </div>
    </div>
    <div ref={track} className="shelf-track" tabIndex={0} aria-label={title + ' posters'}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        scroll(event.key === 'ArrowRight' ? 1 : -1);
      }}>
      {movies.slice(0, visible).map((film) => <Card key={film.id} film={film} {...props} />)}
    </div>
  </section>;
}

export function GlassSegment({ label, choices, value, onChange, className = '' }) {
  const root = useRef(null);
  const active = useRef(null);
  useLayoutEffect(() => {
    const segment = root.current;
    const mark = () => {
      if (!active.current) return;
      segment.style.setProperty('--lens-left', active.current.offsetLeft + 'px');
      segment.style.setProperty('--lens-width', active.current.offsetWidth + 'px');
    };
    mark();
    const resize = new ResizeObserver(mark);
    resize.observe(segment);
    if (active.current) resize.observe(active.current);
    return () => resize.disconnect();
  }, [value]);
  return <div ref={root} className={'segment glass ' + className} aria-label={label}>
    <span className="segment-lens glass" aria-hidden="true" />
    {choices.map(([key, name, Icon]) => <button type="button" key={key} ref={key === value ? active : undefined}
      title={name} aria-label={name} aria-pressed={key === value} onClick={() => onChange(key)}>
      {Icon ? <Icon size={16} /> : name}
    </button>)}
  </div>;
}

function Choice({ icon: Icon, label, value, values, onChange }) {
  return <label className="glass select">
    {Icon && <Icon size={15} />}
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {values.map(([key, title]) => <option value={key} key={key}>{title}</option>)}
    </select>
    <ChevronDown size={13} />
  </label>;
}

export function LibraryFilters({ filters, genres, films, change, reset, onSurprise, canSurprise }) {
  const { status, genre, min, max, sort, descending, group, groupOrder } = filters;
  const presets = [['Any', 0, 600], ['Short', 1, 99], ['Feature', 100, 139], ['Long', 140, 600]];
  const quickGenres = ['', ...genres.slice(0, 5)];
  return <section className="library-filters" aria-label="Library filters">
    <div className="filter-block">
      <div className="filter-label"><h3>Genre</h3>{activeFilters(filters) && <button type="button" className="text-action" onClick={reset}>Reset</button>}</div>
      <div className="quick-genres">{quickGenres.map((value) => <button type="button" className={'glass filter-chip' + (genre === value ? ' chosen' : '')}
        key={value} aria-pressed={genre === value} onClick={() => change({ genre: value })}>{value || 'All'}</button>)}</div>
      <Choice label="Genre" value={genre} values={[[ '', 'All genres' ], ...[...genres].sort().map((name) => [name, name])]} onChange={(value) => change({ genre: value })} />
    </div>
    <div className="filter-block">
      <h3>Runtime</h3>
      <div className="runtime-presets">{presets.map(([name, start, end]) => {
        const selected = min === start && max === end;
        return <button type="button" key={name} className={'glass filter-chip' + (selected ? ' chosen' : '')}
          aria-pressed={selected} onClick={() => change({ min: start, max: end })}>
          {selected && <Check size={12} strokeWidth={2.15} aria-hidden="true" />}{name}
        </button>;
      })}</div>
      <div className="runtime-range" style={{ '--low': min / 6 + '%', '--high': max / 6 + '%' }}>
        <div className="range-line"><span /></div>
        <input type="range" aria-label="Minimum runtime" aria-valuetext={min + ' minutes'} min="0" max="600" value={min} onChange={(event) => change({ min: Math.min(+event.target.value, max - 1) })} />
        <input type="range" aria-label="Maximum runtime" aria-valuetext={max + ' minutes'} min="0" max="600" value={max} onChange={(event) => change({ max: Math.max(+event.target.value, min + 1) })} />
      </div>
      <div className="runtime-values" aria-hidden="true"><span>{min} min</span><span>{max} min</span></div>
    </div>
    <div className="filter-block">
      <h3>Watch status</h3>
      <GlassSegment label="Filter by watch status" value={status} choices={[[ 'all', 'All' ], ['unwatched', 'Unwatched'], ['watched', 'Watched']]}
        onChange={(value) => change({ status: value })} className="status-segment" />
    </div>
    {Object.entries(formatGroups).map(([label, options], index) => {
      const key = ['edition', 'resolution', 'dynamicRange', 'audio'][index];
      const choices = options.filter(([id, , matches]) => filters[key] === id || films.some((film) => matches(film.file)));
      if (!choices.length) return null;
      return <div className="filter-block" key={key} role="group" aria-label={label}>
        <h3>{label}</h3>
        <div className="format-choices">
          {[['', 'Any'], ...choices].map(([id, name, , mark, suffix]) => <button type="button"
            className={'glass filter-chip' + (filters[key] === id ? ' chosen' : '')} key={id}
            aria-label={name} title={name} aria-pressed={filters[key] === id} onClick={() => change({ [key]: id })}>
            <FormatMark label={name} mark={mark} suffix={suffix} />
          </button>)}
        </div>
      </div>;
    })}
    <div className="filter-block">
      <h3>Sort &amp; group</h3>
      <div className="sort-field">
        <Choice label="Sort films" value={sort} values={[[ '', 'Featured' ], ['title', 'Title'], ['director', 'Director'], ['year', 'Year'], ['runtime', 'Runtime'], ['rating', 'IMDb rating']]}
          onChange={(value) => change({ sort: value, descending: ['year', 'rating'].includes(value) })} />
        <IconButton icon={descending ? ArrowDownWideNarrow : ArrowUpNarrowWide} label={descending ? 'Descending order' : 'Ascending order'} onClick={() => change({ descending: !descending })} />
      </div>
      <Choice icon={Layers3} label="Group films" value={group} values={[[ '', 'No grouping' ], ['director', 'By director'], ['genre', 'By genre'], ['decade', 'By decade'], ['runtime', 'By runtime']]} onChange={(value) => change({ group: value })} />
      {group && <Choice label="Sort groups" value={groupOrder} values={[[ 'name', 'Group name' ], ['count', 'Film count' ]]} onChange={(value) => change({ groupOrder: value })} />}
    </div>
    <button type="button" className="glass button surprise" data-ambient disabled={!canSurprise} onClick={onSurprise}><Shuffle size={15} />Surprise me</button>
  </section>;
}

export function TopSearch({ searchRef, query, onSearch }) {
  return <form className="top-search glass" role="search" onSubmit={(event) => { event.preventDefault(); searchRef.current?.blur(); }}>
    <canvas className="glass-window" aria-hidden="true" />
    <Search size={17} />
    <input ref={searchRef} placeholder="Search films" aria-label="Search films" value={query} onChange={(event) => onSearch(event.target.value)} />
    {query ? <button type="button" onClick={() => onSearch('')} title="Clear search" aria-label="Clear search"><X size={16} /></button>
      : <kbd>Ctrl K</kbd>}
  </form>;
}

export function Empty({ icon: Icon = CircleAlert, title, children, action }) {
  return <div className="empty-state glass"><Icon size={29} strokeWidth={1.5} /><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}

export const NoticeContext = createContext('');

export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null);
  const timer = useRef(null);
  const [closing, setClosing] = useState(false);
  const notice = useContext(NoticeContext);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { clearTimeout(timer.current); dialog.close(); };
  }, []);
  function dismiss() {
    if (closing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setClosing(true);
    timer.current = setTimeout(onClose, 180);
  }
  return <dialog ref={ref} className={'dialog ' + className} aria-label={title} data-closing={closing}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (event.target === ref.current) dismiss(); }}>
    <div className="dialog-inner glass" data-ambient>
      <IconButton icon={X} label="Close dialog" className="dialog-close" onClick={dismiss} />
      {children}
      {notice && <p className="dialog-notice glass" role="status">{notice}</p>}
    </div>
  </dialog>;
}
