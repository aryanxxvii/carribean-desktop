import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  Clapperboard, Compass, Film, HardDrive, Layers3, Play, Plus, Search, Shuffle, Star, X
} from 'lucide-react';
import { asset } from './api';
import { activeFilters, genreNames } from './library';
import posterCache from './posters.json';
import discovery from './discovery.json';

const spotlightFrames = {
  tt0816692: ['interstellar', '52% 34%', '58% 44%'],
  tt1856101: ['blade-runner-2049', '55% 61%', '65% 49%'],
  tt15239678: ['dune-part-two', '53% 32%', '63% 47%'],
  tt2543164: ['arrival', '52% 18%', '60% 46%'],
  tt0068646: ['the-godfather', '50% 17%', '65% 47%'],
  'rec-1': ['white-sun', '55% 22%', '66% 49%'],
  'rec-2': ['a-road-to-a-village', '50% 59%', '68% 48%'],
  'rec-3': ['kagbeni', '54% 34%', '69% 47%'],
  'rec-4': ['pashupati-prasad', '53% 30%', '62% 46%'],
};
const discoveryPosters = new Map(discovery.map((film) => [film.imdb, film.poster]));
export const moviePoster = (film) => {
  const cached = posterCache[film.imdb];
  if (cached && cached.source === film.poster) return asset(cached.file);
  const recommendation = discoveryPosters.get(film.imdb);
  if (recommendation && (!film.poster || /^https:\/\/afterlight-watchlist\.aryanwdn\.chatgpt\.site\/posters\//.test(film.poster))) return asset(recommendation);
  return asset(film.poster);
};
export const prettyNumber = (number) => number.toLocaleString();
export const movieFacts = (film) => [film.year, film.runtime ? film.runtime + ' min' : '', genreNames(film).slice(0, 2).join(' · ') || film.mood].filter(Boolean);
export const shortDescription = (film) => film.imdb === 'tt0816692'
  ? 'With Earth dying, a pilot leads a team through a wormhole in search of a new home for humanity.'
  : film.description;

export function Brand() {
  return <div className="brand"><Film size={13} strokeWidth={1.65} aria-hidden="true" /><span>Carribean</span></div>;
}

export function IconButton({ icon: Icon, label, className = '', children, ...props }) {
  return <button type="button" className={'glass icon-button ' + className} title={label} aria-label={label} {...props}>
    {Icon && <Icon size={18} strokeWidth={1.8} />}{children}
  </button>;
}

export function Sidebar({ view, select, lists, onCreate, device, onSettings, count, filterPanel, filtersOpen }) {
  return <aside className="sidebar glass" data-ambient>
    <Brand />
    <div className="side-content">
      <nav className="side-nav" aria-label="Main navigation">
        <button className={'side-link glass ' + (view === 'library' ? 'selected' : '')} onClick={() => select('library')} aria-current={view === 'library' ? 'page' : undefined}>
          <Clapperboard size={18} /><span>Library</span><span className="side-count">{prettyNumber(count)}</span>
        </button>
        <button className={'side-link glass ' + (view === 'discover' ? 'selected' : '')} onClick={() => select('discover')} aria-current={view === 'discover' ? 'page' : undefined}>
          <Compass size={18} /><span>Discover</span>
        </button>
      </nav>
      <nav className="side-watchlists" aria-label="Watchlists">
        <div className="side-label side-label-row">
          <button className={'side-link glass ' + (view === 'watchlists' ? 'selected' : '')} onClick={() => select('watchlists')}
            aria-current={view === 'watchlists' ? 'page' : undefined}><Bookmark size={16} /><span>Watchlists</span></button>
          <IconButton icon={Plus} label="New watchlist" className="side-add" onClick={onCreate} />
        </div>
        {lists.map((list) => <button key={list.id} title={list.name} className={'side-link glass ' + (view === list.id ? 'selected' : '')}
          aria-current={view === list.id ? 'page' : undefined} onClick={() => select(list.id)}>
          <Bookmark size={16} /><span>{list.name}</span><span className="side-count">{list.filmIds.length}</span>
        </button>)}
      </nav>
      {filterPanel && <div id="library-filters" className={'filter-drawer' + (filtersOpen ? ' open' : '')}>{filterPanel}</div>}
    </div>
    <div className="side-bottom">
      <button className="glass drive-card" onClick={onSettings} title={device.moviePath || 'Connect a drive'}>
        <span className="drive-icon"><HardDrive size={19} strokeWidth={1.65} /></span>
        <span className="drive-copy"><strong>Local drive</strong>
          <small><i className={device.connected ? 'online' : ''} />{device.connected ? 'Connected' : device.moviePath ? 'Disconnected' : 'Choose a folder'}</small>
        </span>
        <ChevronRight size={14} />
      </button>
    </div>
  </aside>;
}

function FilmArtwork({ film, active }) {
  const [failedImages, setFailedImages] = useState([]);
  const frame = spotlightFrames[film.recommendationId] || spotlightFrames[film.imdb];
  const still = frame && asset('art/spotlight/' + frame[0] + '.webp');
  const src = [still, moviePoster(film)].find((image) => image && !failedImages.includes(image));
  const focus = still && src === still ? frame.slice(1) : ['50% 33%', '58% 34%'];
  return <div className="spotlight-art" data-current={active}
    style={{ '--art-focus': focus[0], '--art-focus-narrow': focus[1] }}>
    {src && <img key={src} className="spotlight-image" src={src} alt="" fetchPriority={active ? 'high' : 'low'}
      decoding="async" data-glass-art={active ? '' : undefined}
      onError={() => setFailedImages((images) => [...images, src])} />}
  </div>;
}

export function Spotlight({ film, movies, onMove, onSet, onDetails, onPlay, onSave, discover = false }) {
  if (!film) return null;
  const position = movies.indexOf(film);
  return <section className="spotlight" data-art-source aria-label={discover ? 'Featured recommendation' : 'Featured film'}>
    <div className="spotlight-images" aria-hidden="true">
      {movies.map((movie) => <FilmArtwork key={movie.id} film={movie} active={film.id === movie.id} />)}
    </div>
    <div className="spotlight-shade" />
    <div className="spotlight-copy">
      <div className="spotlight-caption" key={film.id}>
        <span className="feature-label">{discover ? 'Afterlight' : 'Featured'}</span>
        <h2>{film.title}</h2>
        <div className="spotlight-facts">
          {movieFacts(film).map((fact) => <span key={fact}>{fact}</span>)}
          {!!film.rating && <span className="feature-score"><Star size={14} fill="currentColor" />{film.rating.toFixed(1)}</span>}
        </div>
        {shortDescription(film) && <p>{shortDescription(film)}</p>}
      </div>
      <div className="spotlight-actions">
        {film.onDisk
          ? <button className="button glass primary" onClick={() => onPlay(film)}><Play size={15} fill="currentColor" />Play film</button>
          : <button className="button glass primary" onClick={() => onSave(film)}><Bookmark size={17} />Save film</button>}
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

export function Card({ film, saved, onDetails, onSave, onWatched }) {
  const image = moviePoster(film);
  return <article className="movie-card">
    <div className="poster-box" data-art-source>
      <button className="poster-action" aria-label={'Details for ' + film.title} onClick={() => onDetails(film)}>
        <span className="no-poster"><Film size={26} strokeWidth={1.2} /><span>{film.title}</span></span>
        {image && <img key={image} src={image} alt="" loading="lazy" decoding="async" data-glass-art onError={(event) => { event.currentTarget.hidden = true; }} />}
      </button>
      {film.rating > 0 && <span className="poster-rating glass"><Star size={12} fill="currentColor" />{film.rating.toFixed(1)}</span>}
      <IconButton icon={Bookmark} className={'bookmark ' + (saved ? 'saved' : '')} label={'Watchlists for ' + film.title}
        aria-pressed={saved} onClick={() => onSave(film)} />
      {film.catalogued && !film.onDisk && <span className="poster-offline glass" title="File unavailable on this device">Offline</span>}
      {film.id.startsWith('film-') && onWatched && <IconButton icon={Check} className={'poster-seen ' + (film.watched ? 'watched' : '')}
        label={(film.watched ? 'Mark unwatched ' : 'Mark watched ') + film.title} aria-pressed={!!film.watched} onClick={() => onWatched(film)} />}
    </div>
    <button className="movie-name" onClick={() => onDetails(film)} title={film.title}>{film.title}</button>
    <div className="movie-facts">
      {film.year && <span>{film.year}</span>}
      {(film.runtime > 0 || film.origin) && <><span className="fact-dot" /><span>{film.runtime ? film.runtime + ' min' : film.origin}</span></>}
    </div>
  </article>;
}

export function MovieGrid({ movies, listMode, ...props }) {
  return <div className={listMode ? 'movie-grid list-mode' : 'movie-grid'}>
    {movies.map((film) => <Card key={film.id} film={film} {...props} saved={props.isSaved(film)} />)}
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

export function Shelf({ title, movies, ...props }) {
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
      <h2>{title}</h2>
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
      {movies.slice(0, visible).map((film) => <Card key={film.id} film={film} {...props} saved={props.isSaved(film)} />)}
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

export function LibraryFilters({ filters, genres, change, reset, onSurprise }) {
  const { status, genre, min, max, sort, descending, group, groupOrder } = filters;
  const presets = [['Any', 0, 600], ['Short', 1, 99], ['Feature', 100, 139], ['Long', 140, 600]];
  const quickGenres = ['', ...genres.slice(0, 5)];
  return <section className="library-filters" aria-label="Library filters">
    <div className="filter-heading"><h2>Filters</h2>{activeFilters(filters) && <button type="button" className="text-action" onClick={reset}>Reset</button>}</div>
    <div className="filter-block">
      <h3>Genre</h3>
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
    <div className="filter-block">
      <h3>Sort &amp; group</h3>
      <div className="sort-field">
        <Choice label="Sort films" value={sort} values={[[ '', 'Featured' ], ['title', 'Title'], ['director', 'Director'], ['year', 'Year'], ['runtime', 'Runtime'], ['rating', 'IMDb rating']]}
          onChange={(value) => change({ sort: value, descending: ['year', 'rating'].includes(value) })} />
        <IconButton icon={descending ? ArrowDownWideNarrow : ArrowUpNarrowWide} label={descending ? 'Descending order' : 'Ascending order'} onClick={() => change({ descending: !descending })} />
      </div>
      <Choice icon={Layers3} label="Group films" value={group} values={[[ '', 'No grouping' ], ['director', 'By director'], ['genre', 'By genre'], ['runtime', 'By runtime']]} onChange={(value) => change({ group: value })} />
      {group && <Choice label="Sort groups" value={groupOrder} values={[[ 'name', 'Group name' ], ['count', 'Film count' ]]} onChange={(value) => change({ groupOrder: value })} />}
    </div>
    <button type="button" className="glass button surprise" data-ambient onClick={onSurprise}><Shuffle size={15} />Surprise me</button>
  </section>;
}

export function TopSearch({ searchRef, query, onSearch, onSubmit }) {
  return <form className="top-search glass" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
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
