import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check, CircleAlert, Film, Grid2X2, HardDrive, LayoutList, PanelsTopLeft, RefreshCw, Search, Settings2, SlidersHorizontal
} from 'lucide-react';
import { call, native } from './api';
import {
  Empty, GlassSegment, IconButton, LibraryFilters, Modal, MovieGrid, NoticeContext, ScrollContinuation, Shelf, Spotlight, TopSearch, prettyNumber
} from './components';
import { FilmDetails, MetadataEditor, Settings } from './dialogs';
import { activeFilters, defaultFilters, filterLibrary, findFilms, genresIn, groupLibrary, programLibrary } from './library';
import { mountGlass } from './glass';
import './styles.css';

const defaultDevice = { moviePath: '', git: { remote: '', branch: 'carribean-library', name: '', email: '', startup: true }, connected: false };
const pageSize = 36;
const layouts = [['shelves', 'Shelves', PanelsTopLeft], ['grid', 'Poster grid', Grid2X2], ['list', 'Compact list', LayoutList]];

const newProgram = () => ({ seed: Math.floor(Math.random() * 0x100000000) });

function App() {
  const [data, setData] = useState({ films: [], device: defaultDevice });
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState('shelves');
  const [filters, setFilters] = useState(defaultFilters);
  const [program, setProgram] = useState(newProgram);
  const [limit, setLimit] = useState(pageSize);
  const [slide, setSlide] = useState(0);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [toastError, setToastError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const nextPage = useCallback(() => setLimit((current) => current + pageSize), []);
  const requestNumber = useRef(0);
  const lastSnapshot = useRef('');
  const searchRef = useRef(null);
  const toastTimer = useRef(null);
  const lastError = useRef('');
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'instant' });
  const setNotice = (message, failure = false) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    setToastError(failure);
    if (message) toastTimer.current = setTimeout(() => setToast(''), 4400);
  };
  function update(state) {
    const signature = JSON.stringify(state);
    if (signature !== lastSnapshot.current) {
      lastSnapshot.current = signature;
      setData(state);
    }
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      const requested = requestNumber.current;
      try {
        const snapshot = await call('snapshot');
        if (!active || requested !== requestNumber.current) return;
        update(snapshot);
        if (snapshot.error && snapshot.error !== lastError.current) setNotice(snapshot.error, true);
        lastError.current = snapshot.error;
      } catch (error) {
        if (active && !lastError.current) { lastError.current = error.message; setNotice(error.message, true); }
        if (active) setLoaded(true);
      }
    };
    void refresh();
    const interval = setInterval(refresh, 1800);
    document.addEventListener('visibilitychange', refresh);
    const keys = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', keys);
    return () => { active = false; clearInterval(interval); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('keydown', keys); };
  }, []);

  const onDrive = useMemo(() => data.films.filter((film) => film.onDisk), [data.films]);
  const searchTerm = query.trim();
  const filtersActive = activeFilters(filters);
  const showingShelves = !searchTerm && layout === 'shelves' && !filtersActive;
  const filtered = useMemo(() => filterLibrary(onDrive, filters), [onDrive, filters]);
  const results = useMemo(() => searchTerm ? findFilms(filtered, searchTerm) : filtered, [filtered, searchTerm]);
  const genres = useMemo(() => genresIn(onDrive), [onDrive]);
  const { featured, shelves } = useMemo(() => programLibrary(onDrive, program), [onDrive, program]);
  function search(next) {
    setQuery(next);
    setLimit(pageSize);
    scrollTop();
  }
  async function mutate(action, payload, message) {
    requestNumber.current++;
    try {
      const snapshot = await call(action, payload);
      requestNumber.current++;
      update(snapshot);
      if (message) setNotice(message);
      return snapshot;
    } catch (error) {
      setNotice(error.message, true);
      return null;
    }
  }
  function changeFilters(values) {
    setFilters((state) => ({ ...state, ...values }));
    setLimit(pageSize);
    scrollTop();
  }
  const showModal = (next) => { setNotice(''); setModal(next); };
  const details = (film) => showModal({ kind: 'detail', film });
  const settings = () => showModal({ kind: 'settings' });
  const close = () => setModal(null);
  const play = async (film) => {
    try { await call('play', { id: film.id }); }
    catch (error) { setNotice(error.message, true); }
  };
  const toggleWatched = (film) => mutate('watched', { id: film.id, value: !film.watched }, film.watched ? 'Marked unwatched' : 'Marked watched');
  const surprise = () => { if (results.length) details(results[Math.floor(Math.random() * results.length)]); };
  async function sync() {
    if (syncing) return;
    setSyncing(true);
    const snapshot = await mutate('sync');
    if (snapshot) {
      const scan = snapshot.scanSummary;
      const changes = scan ? [`${scan.files} on drive`, scan.found && `${scan.found} found`,
        scan.missing && `${scan.missing} removed from Library`, scan.updated && `Metadata updated for ${scan.updated}`].filter(Boolean) : [];
      if (scan?.backdrops?.total) changes.push(`${scan.backdrops.ready}/${scan.backdrops.total} backdrops ready`);
      if (snapshot.device.git.remote) changes.push('Git backup synced');
      setNotice(snapshot.device.connected ? changes.join(' · ') || 'Movie folder refreshed'
        : 'Movie folder unavailable' + (changes.length ? ' · ' + changes.join(' · ') : ''));
    } else void call('snapshot').then(update).catch(() => {});
    setSyncing(false);
  }
  const gridProps = { onDetails: details, onPlay: play, onWatched: toggleWatched };
  const activeFilm = modal?.film && data.films.find((film) => film.id === modal.film.id);
  const libraryFilters = <LibraryFilters filters={filters} genres={genres} films={onDrive} change={changeFilters}
    reset={() => changeFilters(defaultFilters)} onSurprise={surprise} canSurprise={results.length > 0} />;
  const grouped = useMemo(() => groupLibrary(results, filters), [results, filters]);
  const groupedCount = grouped.reduce((sum, [, films]) => sum + films.length, 0);
  let cardsLeft = limit;
  const visibleGroups = grouped.flatMap(([name, movies]) => {
    if (!cardsLeft) return [];
    const shown = movies.slice(0, cardsLeft);
    cardsLeft -= shown.length;
    return [[name, shown, movies.length]];
  });
  return <NoticeContext.Provider value={toast}><div className={'app-shell' + (native ? ' native' : '') + (onDrive.length ? '' : ' without-sidebar')}>
    {!!onDrive.length && <aside className="sidebar glass" data-ambient>{libraryFilters}</aside>}
    <main className="main-shell" id="main">
      <header className="page-heading library-header">
        <h1 className="sr-only">Caribbean Library</h1>
        <div className="toolbar">
          <TopSearch searchRef={searchRef} query={query} onSearch={search} />
          <div className="global-actions glass">
            <canvas className="glass-window" aria-hidden="true" />
            <IconButton icon={RefreshCw} label="Sync library" title={data.activity || 'Sync library'}
              className={syncing || data.activity ? 'spinner' : ''} disabled={syncing}
              onClick={data.device.moviePath || data.device.git.remote ? sync : settings} />
            <IconButton icon={Settings2} label="Settings" onClick={settings} />
          </div>
        </div>
      </header>
      <div className="workspace">
        {showingShelves && !!featured.length && <Spotlight
          film={featured[slide % featured.length]} movies={featured}
          onDetails={details} onPlay={play} onSet={setSlide}
          onRefresh={() => { setProgram(newProgram()); setSlide(0); }}
          onMove={(step) => setSlide((value) => (value + step + featured.length) % featured.length)} />}
        {!!onDrive.length && <div className="library-tools">
          {!showingShelves && <span role="status">{prettyNumber(results.length)} {searchTerm ? (results.length === 1 ? 'match' : 'matches') : (results.length === 1 ? 'film' : 'films')}</span>}
          <button type="button" className={'button glass secondary mobile-filter' + (filtersActive ? ' chosen' : '')}
            aria-haspopup="dialog" onClick={() => showModal({ kind: 'filters' })}><SlidersHorizontal size={16} />Filters</button>
          <GlassSegment label="Library layout" choices={layouts} value={layout}
            onChange={(value) => { setLimit(pageSize); setLayout(value); }} className="view-switch" />
        </div>}
        {!loaded && <div className="loading-hero" role="status">Loading library…</div>}
        {loaded && !onDrive.length && <Empty icon={HardDrive}
          title={data.device.connected ? 'No movies found in this folder' : data.device.moviePath ? 'Movie drive disconnected' : 'Connect your movie folder'}
          action={<button className="button glass primary" onClick={settings}><HardDrive size={16} />Library settings</button>} />}
        {showingShelves && shelves.map(({ name, reason, movies, mark, suffix }) => <Shelf key={name} title={name} reason={reason} movies={movies} mark={mark} suffix={suffix} {...gridProps} />)}
        {!showingShelves && !!onDrive.length && (results.length ? visibleGroups.map(([name, movies, groupSize]) => <section
          className="film-group" key={name} aria-label={name}>
          {filters.group && <div className="shelf-heading"><h2>{name}</h2><span>{groupSize}</span></div>}
          <MovieGrid movies={movies} listMode={layout === 'list'} {...gridProps} />
        </section>) : <Empty icon={searchTerm ? Search : Film}
          title={searchTerm && !filtersActive ? 'No matching films on your drive' : 'No films match these filters'}
          action={filtersActive && <button className="button glass secondary" onClick={() => changeFilters(defaultFilters)}>Reset filters</button>} />)}
        {!showingShelves && groupedCount > limit && <ScrollContinuation page={limit} onLoad={nextPage} />}
      </div>
    </main>
    {modal?.kind === 'filters' && <Modal title="Library filters" onClose={close} className="filter-dialog">
      {libraryFilters}
      <button type="button" className="button glass primary filter-done" onClick={close}>
        Show {prettyNumber(results.length)} {results.length === 1 ? 'film' : 'films'}
      </button>
    </Modal>}
    {modal?.kind === 'detail' && activeFilm && <FilmDetails key="detail" film={activeFilm} onClose={close}
      onPlay={play} onWatched={toggleWatched} onEdit={(film) => showModal({ kind: 'metadata', film })} />}
    {modal?.kind === 'metadata' && activeFilm && <MetadataEditor key="metadata" film={activeFilm}
      onClose={close} onSave={async (values) => {
        if (await mutate('metadata', { id: activeFilm.id, ...values }, 'Metadata updated')) setModal({ kind: 'detail', film: activeFilm });
      }} />}
    {modal?.kind === 'settings' && <Settings key="settings" device={data.device} onClose={close} onUpdate={update} onToast={setNotice} />}
    <div role="status" className={'toast glass' + (toast && !modal ? ' visible' : '')}>{toast && !modal && <>
      {toastError ? <CircleAlert size={16} /> : <Check size={16} />}<span>{toast}</span>
    </>}</div>
  </div></NoticeContext.Provider>;
}

createRoot(document.getElementById('root')).render(<App />);
mountGlass();
