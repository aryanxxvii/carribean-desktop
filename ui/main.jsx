import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bookmark, Check, CircleAlert, Film, Globe2, Grid2X2, HardDrive, LayoutList, PanelsTopLeft,
  Plus, RefreshCw, Search, Settings2, SlidersHorizontal, SquarePen
} from 'lucide-react';
import { call, native } from './api';
import {
  Empty, GlassSegment, IconButton, LibraryFilters, MovieGrid, NoticeContext, ScrollContinuation, Shelf, Sidebar, Spotlight, TopSearch, moviePoster, prettyNumber
} from './components';
import { FilmDetails, ManualFilm, MetadataEditor, SaveDialog, Settings, WatchlistEditor } from './dialogs';
import { FindFilms, LookupInput, useLookup } from './lookup';
import { activeFilters, defaultFilters, filterLibrary, findFilms, genresIn, groupLibrary, sameFilm, shelvesFor } from './library';
import discovery from './discovery.json';
import { mountGlass } from './glass';
import './styles.css';

const defaultDevice = { moviePath: '', git: { remote: '', branch: 'carribean-library', name: '', email: '', startup: true }, connected: false };
const featuredIds = ['tt0816692', 'tt1856101', 'tt15239678', 'tt2543164', 'tt0068646'];
const pageSize = 36;
const layouts = [['shelves', 'Shelves', PanelsTopLeft], ['grid', 'Poster grid', Grid2X2], ['list', 'Compact list', LayoutList]];
const portableFilm = (film) => film?.poster?.startsWith('recommendations/')
  ? { ...film, poster: 'https://afterlight-watchlist.aryanwdn.chatgpt.site/posters/' + film.poster.split('/').at(-1) } : film;

function App() {
  const [data, setData] = useState({ films: [], lists: [], device: defaultDevice });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('library');
  const [layout, setLayout] = useState('shelves');
  const [filters, setFilters] = useState(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [region, setRegion] = useState('');
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
  const lookup = useLookup();
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'instant' });
  const setNotice = (message, failure = false) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    setToastError(failure);
    if (message) toastTimer.current = setTimeout(() => setToast(''), 4400);
  };
  function update(snapshot) {
    const { savedListId: _id, ...state } = snapshot;
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

  const filmsById = useMemo(() => new Map(data.films.map((film) => [film.id, { ...film, persisted: true }])), [data.films]);
  const imdbIndex = useMemo(() => new Map([...filmsById.values()].filter((film) => film.imdb).map((film) => [film.imdb, film])), [filmsById]);
  const resolveFilm = (film) => filmsById.get(film.id) || (film.imdb ? imdbIndex.get(film.imdb) : undefined) || film;
  const catalogue = useMemo(() => data.films.filter((film) => film.catalogued), [data.films]);
  const onDrive = useMemo(() => catalogue.filter((film) => film.onDisk), [catalogue]);
  const showingShelves = layout === 'shelves' && !activeFilters(filters);
  const catalogueSource = showingShelves && onDrive.length ? onDrive : catalogue;
  const filtered = useMemo(() => filterLibrary(catalogueSource, filters), [catalogueSource, filters]);
  const genres = useMemo(() => genresIn(catalogue), [catalogue]);
  const shelves = useMemo(() => shelvesFor(filtered, genres), [filtered, genres]);
  const featured = useMemo(() => {
    const index = new Map(filtered.map((film) => [film.imdb, film]));
    return [...new Set([...featuredIds.map((id) => index.get(id)).filter(Boolean), ...filtered.filter(moviePoster)])].slice(0, 5);
  }, [filtered]);
  const lists = data.lists;
  const currentList = lists.find((list) => list.id === view);
  const savedIds = useMemo(() => new Set(data.lists.flatMap((list) => list.filmIds)), [data.lists]);
  const isSaved = (film) => savedIds.has(resolveFilm(film).id);
  const discoverFilms = useMemo(() => discovery.map((film) => {
    const known = imdbIndex.get(film.imdb);
    return { ...film, ...known, recommendationId: film.id, poster: known?.poster || film.poster, description: known?.description || film.description };
  }), [imdbIndex]);
  const searchCatalog = useMemo(() => [...new Map([...filmsById.values(), ...discoverFilms].map((film) => [film.id, film])).values()], [filmsById, discoverFilms]);
  const regions = useMemo(() => [...new Set(discovery.map((film) => film.region))], []);
  const discoverRegion = discoverFilms.filter((film) => !region || film.region === region);
  const featuredDiscovery = discoverFilms.filter((film) => ['rec-1', 'rec-2', 'rec-3', 'rec-4'].includes(film.recommendationId));
  const searchTerm = lookup.query.trim();
  const localMatches = searchTerm ? findFilms(searchCatalog, searchTerm) : [];
  const onlineMatches = (lookup.remote || []).filter((film) => !localMatches.some((known) => sameFilm(known, film)));

  function select(next) {
    lookup.change('');
    setView(next);
    setLimit(pageSize);
    setSlide(0);
    setRegion('');
    scrollTop();
  }
  function search(next) {
    lookup.change(next);
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
  const details = (film) => showModal({ kind: 'detail', film: resolveFilm(film) });
  const saveFilm = (film) => showModal({ kind: 'save', film: resolveFilm(film) });
  const settings = () => showModal({ kind: 'settings' });
  const newWatchlist = () => showModal({ kind: 'list' });
  const close = () => setModal(null);
  const findForList = () => showModal({ kind: 'find', listId: currentList.id });
  const play = async (film) => {
    try { await call('play', { id: film.id }); }
    catch (error) { setNotice(error.message, true); }
  };
  const toggleWatched = (film) => mutate('watched', { id: film.id, value: !film.watched }, film.watched ? 'Marked unwatched' : 'Marked watched');
  const surprise = () => { if (filtered.length) details(filtered[Math.floor(Math.random() * filtered.length)]); };
  const toggleMembership = async (list, film, include) => {
    const existing = list.filmIds.map((id) => filmsById.get(id)).find((entry) => entry && sameFilm(entry, film));
    const snapshot = await mutate('membership', { id: existing?.id || film.id, film: portableFilm(film), list: list.id, value: include },
      include ? 'Saved to ' + list.name : 'Removed from ' + list.name);
    if (snapshot) {
      const stored = snapshot.films.find((entry) => sameFilm(entry, film));
      if (stored) setModal((current) => current?.kind === 'save' ? { ...current, film: stored } : current);
    }
    return snapshot;
  };
  async function sync() {
    if (syncing) return;
    setSyncing(true);
    const snapshot = await mutate('sync');
    if (snapshot) {
      setNotice(snapshot.device.git.remote ? 'Git backup synced' : snapshot.device.connected
        ? 'Movie folder refreshed' : 'Drive disconnected. Your saved catalog is available.');
    } else void call('snapshot').then(update).catch(() => {});
    setSyncing(false);
  }
  const spotlightProps = (films) => ({
    film: films[slide % films.length], movies: films, onDetails: details, onSave: saveFilm, onPlay: play,
    onMove: (step) => setSlide((value) => (value + step + films.length) % films.length), onSet: setSlide
  });
  const gridProps = { isSaved, onDetails: details, onSave: saveFilm, onWatched: toggleWatched };
  const activeFilm = modal?.film && resolveFilm(modal.film);
  const modalList = modal?.listId && lists.find((list) => list.id === modal.listId);
  const activeView = searchTerm ? 'search' : view;
  const title = searchTerm ? view === 'discover' ? 'Discover' : 'Search results'
    : view === 'library' ? 'Library' : view === 'discover' ? 'Discover' : currentList?.name || 'Watchlists';
  const libraryFilters = view === 'library' && !!catalogue.length
    ? <LibraryFilters filters={filters} genres={genres} change={changeFilters} reset={() => changeFilters(defaultFilters)} onSurprise={surprise} /> : null;
  const grouped = useMemo(() => groupLibrary(filtered, filters), [filtered, filters]);
  const groupedCount = grouped.reduce((sum, [, films]) => sum + films.length, 0);
  let cardsLeft = limit;
  const visibleGroups = grouped.flatMap(([name, movies]) => {
    if (!cardsLeft) return [];
    const shown = movies.slice(0, cardsLeft);
    cardsLeft -= shown.length;
    return [[name, shown, movies.length]];
  });
  const centeredSearch = view === 'library';
  return <NoticeContext.Provider value={toast}><div className={'app-shell' + (native ? ' native' : '')}>
    <Sidebar view={view} select={select} lists={lists} onCreate={newWatchlist} device={data.device}
      onSettings={settings} count={onDrive.length || catalogue.length} filterPanel={libraryFilters} filtersOpen={filtersOpen} />
    <main className="main-shell" id="main">
      <header className={'page-heading' + (centeredSearch ? ' library-header' : '')}>
        <div className={centeredSearch ? 'sr-only' : 'page-title'}>
          <h1>{title}</h1>
          {currentList && !searchTerm && <span className="library-stats">{currentList.filmIds.length} {currentList.filmIds.length === 1 ? 'film' : 'films'}</span>}
        </div>
        <div className="toolbar">
          {view !== 'discover' && <TopSearch searchRef={searchRef} query={lookup.query} onSearch={search} onSubmit={lookup.submit} />}
          <div className="global-actions glass">
            <canvas className="glass-window" aria-hidden="true" />
            <IconButton icon={RefreshCw} label="Sync library" className={syncing || data.activity ? 'spinner' : ''} disabled={syncing}
              onClick={data.device.moviePath || data.device.git.remote ? sync : settings} />
            <IconButton icon={Settings2} label="Settings" onClick={settings} />
          </div>
        </div>
      </header>
      {view === 'discover' && <div className="discover-bar">
        <div className="discover-search">
          <LookupInput lookup={lookup} inputRef={searchRef} placeholder="Find a film by title" />
          <button className="button glass secondary" onClick={() => showModal({ kind: 'manual' })}><Plus size={16} />Add by title</button>
        </div>
      </div>}
      <div className="workspace" key={activeView}>
        {activeView === 'library' && <>
          {showingShelves && !!featured.length && <Spotlight {...spotlightProps(featured)} />}
          {!!catalogue.length && <div className="library-tools">
            {!showingShelves && <span>{prettyNumber(filtered.length)} {filtered.length === 1 ? 'film' : 'films'}</span>}
            <button type="button" className="button glass secondary mobile-filter" aria-controls="library-filters" aria-expanded={filtersOpen}
              onClick={() => { if (!filtersOpen) scrollTop(); setFiltersOpen(!filtersOpen); }}><SlidersHorizontal size={16} />Filters</button>
            <GlassSegment label="Library layout" choices={layouts} value={layout} onChange={(value) => { setLimit(pageSize); setLayout(value); }} className="view-switch" />
          </div>}
          {!loaded && <div className="loading-hero" role="status">Loading library…</div>}
          {loaded && !catalogue.length && <Empty icon={HardDrive} title="Connect your movie folder" action={<button className="button glass primary" onClick={settings}><HardDrive size={16} />Choose folder</button>} />}
          {showingShelves && shelves.map(([name, movies]) => <Shelf key={name} title={name} movies={movies} {...gridProps} />)}
          {showingShelves && filtered.length > 0 && !shelves.length && <Shelf title="Films" movies={filtered} {...gridProps} />}
          {!showingShelves && (!!filtered.length ? visibleGroups.map(([name, movies, groupSize]) => <section className="film-group" key={name} aria-label={name}>
            {filters.group && <div className="shelf-heading"><h2>{name}</h2><span>{groupSize}</span></div>}
            <MovieGrid movies={movies} listMode={layout === 'list'} {...gridProps} />
          </section>) : <Empty icon={Film} title="No films match these filters" action={<button className="button glass secondary" onClick={() => changeFilters(defaultFilters)}>Reset filters</button>} />)}
          {!showingShelves && groupedCount > limit && <ScrollContinuation page={limit} onLoad={nextPage} />}
        </>}
        {activeView === 'discover' && <>
          {!region && !!featuredDiscovery.length && <Spotlight discover {...spotlightProps(featuredDiscovery)} />}
          <div className="region-filters" aria-label="Filter recommendations by region">
            {['', ...regions].map((item) => <button className={'button glass ' + (item === region ? 'chosen' : 'secondary')} key={item}
              aria-pressed={item === region} onClick={() => { setRegion(item); setLimit(pageSize); }}>{item || 'All regions'}</button>)}
          </div>
          <div className="shelf-heading"><h2>{region || 'Afterlight'}</h2><span>{discoverRegion.length} films</span></div>
          <MovieGrid movies={discoverRegion.slice(0, limit)} {...gridProps} />
          {discoverRegion.length > limit && <ScrollContinuation page={limit} onLoad={nextPage} />}
        </>}
        {activeView === 'watchlists' && <div className="watchlist-grid">
          <button className="glass watchlist-card new-list" onClick={newWatchlist}><Plus size={22} /><strong>New watchlist</strong></button>
          {lists.map((list) => <button className="glass watchlist-card" key={list.id} onClick={() => select(list.id)}>
            <Bookmark size={22} /><strong>{list.name}</strong><span>{list.filmIds.length} {list.filmIds.length === 1 ? 'film' : 'films'}</span>
          </button>)}
        </div>}
        {currentList && !searchTerm && <>
          <div className="heading-actions">
            <button className="button glass primary" onClick={findForList}><Search size={16} />Find films</button>
            <IconButton icon={SquarePen} label="Edit watchlist" onClick={() => showModal({ kind: 'list', list: currentList })} />
          </div>
          {currentList.filmIds.length ? <MovieGrid movies={currentList.filmIds.slice(0, limit).map((id) => filmsById.get(id)).filter(Boolean)} {...gridProps} />
            : <Empty icon={Bookmark} title="No saved films" />}
          {currentList.filmIds.length > limit && <ScrollContinuation page={limit} onLoad={nextPage} />}
        </>}
        {searchTerm && <>
          {view !== 'discover' && <div className="search-actions">
            <button className="button glass secondary" disabled={lookup.working || searchTerm.length < 2} onClick={lookup.submit}><Globe2 size={16} />{lookup.working ? 'Searching…' : 'Search online'}</button>
            <button className="button glass secondary" onClick={() => showModal({ kind: 'manual' })}><Plus size={16} />Add by title</button>
          </div>}
          {!!localMatches.length && <section className="film-group"><div className="shelf-heading"><h2>In Carribean</h2><span>{localMatches.length}</span></div>
            <MovieGrid movies={localMatches.slice(0, limit)} {...gridProps} />
            {localMatches.length > limit && <ScrollContinuation page={limit} onLoad={nextPage} />}
          </section>}
          {!!onlineMatches.length && <section className="film-group"><div className="shelf-heading"><h2>Online</h2></div>
            <MovieGrid movies={onlineMatches} {...gridProps} onWatched={null} />
          </section>}
          {!localMatches.length && !onlineMatches.length && !lookup.working && <Empty icon={Search} title={lookup.remote ? 'No films found' : 'No local matches'}
            action={view === 'discover' && !lookup.remote && !lookup.error && <button className="button glass secondary" onClick={lookup.submit}><Globe2 size={16} />Search online</button>} />}
          {lookup.error && <p className="form-error" role="alert">{lookup.error}</p>}
        </>}
      </div>
    </main>
    {modal?.kind === 'detail' && <FilmDetails key="detail" film={activeFilm} onClose={close} onPlay={play} onSave={saveFilm} saved={isSaved(activeFilm)} onWatched={toggleWatched} onEdit={(film) => showModal({ kind: 'metadata', film })} />}
    {modal?.kind === 'save' && <SaveDialog key="save" film={activeFilm} lists={lists} onClose={close} onToggle={(list, value) => toggleMembership(list, activeFilm, value)} onCreate={() => showModal({ kind: 'list', film: activeFilm })} />}
    {modal?.kind === 'list' && <WatchlistEditor key="list" list={modal.list} onClose={close}
      onSave={async (name) => {
        const snapshot = await mutate('list', { id: modal.list?.id, name, film: portableFilm(modal.film) },
          modal.list ? 'Watchlist renamed' : modal.film ? 'Saved to ' + name : 'Watchlist created');
        if (!snapshot) return;
        if (!modal.list && !modal.film) select(snapshot.savedListId);
        close();
      }}
      onDelete={async () => { if (await mutate('removeList', { id: modal.list.id }, 'Watchlist deleted')) { select('watchlists'); close(); } }} />}
    {modal?.kind === 'find' && modalList && <FindFilms key="find" list={modalList} movies={searchCatalog} onClose={close}
      savedMovies={modalList.filmIds.map((id) => filmsById.get(id)).filter(Boolean)}
      onToggle={(film, selected) => toggleMembership(modalList, film, !selected)}
      onManual={() => showModal({ kind: 'manual', listId: modalList.id })} />}
    {modal?.kind === 'manual' && <ManualFilm key="manual" onClose={close} onAdd={async (film) => {
      const entry = { ...film, id: 'manual-' + film.title };
      if (modalList) { if (await toggleMembership(modalList, entry, true)) close(); }
      else saveFilm(entry);
    }} />}
    {modal?.kind === 'metadata' && <MetadataEditor key="metadata" film={activeFilm} movies={searchCatalog.filter((film) => film.id !== activeFilm.id)}
      onClose={close} onSave={async (values) => { if (await mutate('metadata', { id: activeFilm.id, ...values }, 'Metadata updated')) setModal({ kind: 'detail', film: activeFilm }); }} />}
    {modal?.kind === 'settings' && <Settings key="settings" device={data.device} initialTab={modal.tab} onClose={close} onUpdate={update} onToast={setNotice} />}
    <div role="status" className={'toast glass' + (toast && !modal ? ' visible' : '')}>{toast && !modal && <>
      {toastError ? <CircleAlert size={16} /> : <Check size={16} />}<span>{toast}</span>
    </>}</div>
  </div></NoticeContext.Provider>;
}

createRoot(document.getElementById('root')).render(<App />);
mountGlass();
