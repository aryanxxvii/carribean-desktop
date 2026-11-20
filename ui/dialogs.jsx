import { useRef, useState } from 'react';
import { Bookmark, Check, ChevronDown, Download, ExternalLink, Film, FolderOpen, GitBranch, HardDrive, PencilLine, Play, Plus, RefreshCw, Save, Star, Trash2, Upload } from 'lucide-react';
import { call } from './api';
import { GlassSegment, Modal, movieFacts, moviePoster } from './components';
import { LookupInput, LookupResults, useLookup } from './lookup';

export function FilmDetails({ film, onClose, onPlay, onSave, onWatched, onEdit, saved }) {
  const [expanded, setExpanded] = useState(false);
  const poster = moviePoster(film);
  const description = film.description?.trim() || '';
  const cut = description.length > 310 ? description.slice(0, 265).lastIndexOf(' ') : -1;
  return <Modal title={film.title} onClose={onClose} className="film-dialog">
    <div className="film-detail-art" data-art-source>
      <Film size={42} strokeWidth={1.3} aria-hidden="true" />
      {poster && <img src={poster} alt="" data-glass-art onError={(event) => { event.currentTarget.hidden = true; }} />}
    </div>
    <div className="film-detail-copy">
      <header className="detail-heading">
        <span className="detail-availability"><i />{film.onDisk ? 'On your drive' : film.catalogued ? 'In your catalog' : film.origin || 'Film details'}</span>
        <h2>{film.title}</h2>
        <div className="detail-facts">
          {movieFacts(film).map((fact) => <span key={fact}>{fact}</span>)}
          {film.rating > 0 && <span className="detail-rating glass"><Star size={12} fill="currentColor" />{film.rating.toFixed(1)}</span>}
        </div>
      </header>
      {description && <div className="detail-description">
        <p className="synopsis" id="film-synopsis">{!expanded && cut > 0 ? description.slice(0, cut) + '…' : description}</p>
        {cut > 0 && <button type="button" className="text-action synopsis-toggle" aria-expanded={expanded} aria-controls="film-synopsis"
          onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse synopsis' : 'Full synopsis'}<ChevronDown size={13} /></button>}
      </div>}
      {(film.director || film.cast) && <dl className="credits">
        {film.director && <div><dt>Director</dt><dd>{film.director}</dd></div>}
        {film.cast && <div><dt>Cast</dt><dd>{film.cast}</dd></div>}
      </dl>}
      <div className="dialog-actions">
        {film.onDisk && <button className="button glass primary" onClick={() => onPlay(film)}><Play size={16} fill="currentColor" />Play film</button>}
        <button className="button glass secondary" onClick={() => onSave(film)}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Manage watchlists' : 'Add to watchlist'}</button>
      </div>
      <div className="detail-tools">
        {film.id.startsWith('film-') && film.persisted && <button type="button" className={'button glass secondary' + (film.watched ? ' chosen' : '')}
          aria-pressed={film.watched} onClick={() => onWatched(film)}><Check size={15} />{film.watched ? 'Watched' : 'Mark watched'}</button>}
        {film.persisted && <button type="button" className="button glass secondary" onClick={() => onEdit(film)}><PencilLine size={14} />Edit metadata</button>}
        {film.imdb && <a className="button glass secondary" href={'https://www.imdb.com/title/' + film.imdb + '/'} target="_blank" rel="noreferrer">IMDb <ExternalLink size={13} /></a>}
      </div>
    </div>
  </Modal>;
}

export function SaveDialog({ film, lists, onClose, onToggle, onCreate }) {
  return <Modal title="Add to watchlist" onClose={onClose}>
    <div className="eyebrow">Watchlists</div><h2>Save film</h2><p className="modal-subtitle">{film.title}{film.year && ' · ' + film.year}</p>
    <div className="save-choices">
      {lists.map((list) => {
        const checked = list.filmIds.includes(film.id);
        return <button className={'glass save-choice ' + (checked ? 'checked' : '')} key={list.id} aria-pressed={checked}
          onClick={() => onToggle(list, !checked)}>
          <Bookmark size={17} /><span>{list.name}</span>{checked && <Check size={18} />}
        </button>;
      })}
    </div>
    <button className="button glass primary" onClick={onCreate}><Plus size={17} />New watchlist</button>
  </Modal>;
}

export function WatchlistEditor({ list, onClose, onSave, onDelete }) {
  const [name, setName] = useState(list?.name || '');
  const [confirm, setConfirm] = useState(false);
  return <Modal title={list ? 'Edit watchlist' : 'New watchlist'} onClose={onClose}>
    <h2>{list ? 'Edit watchlist' : 'New watchlist'}</h2>
    <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); onSave(name.trim()); }}>
      <label>Watchlist name<input className="glass" autoFocus required maxLength={80} placeholder="e.g. Friday night films" value={name} onChange={(event) => setName(event.target.value)} /></label>
      {confirm && <p className="form-note">Delete “{list.name}” and its saved entries?</p>}
      <div className="dialog-actions">
        <button className="button glass primary" disabled={!name.trim()}><Save size={16} />{list ? 'Save changes' : 'Create watchlist'}</button>
        {list && <button type="button" className="button glass danger" onClick={() => confirm ? onDelete() : setConfirm(true)}><Trash2 size={16} />{confirm ? 'Confirm delete' : 'Delete watchlist'}</button>}
      </div>
    </form>
  </Modal>;
}

export function MetadataEditor({ film, movies, onClose, onSave }) {
  const [imdb, setImdb] = useState('');
  const [poster, setPoster] = useState('');
  const lookup = useLookup(film.title);
  return <Modal title="Edit metadata" onClose={onClose} className="lookup-dialog">
    <h2>Edit metadata</h2><p className="modal-subtitle">{film.title}</p>
    <LookupInput lookup={lookup} />
    <LookupResults lookup={lookup} movies={movies} action="Use" onPick={(candidate) => onSave({ candidate, poster: poster.trim() })} />
    <details className="metadata-manual">
      <summary>IMDb ID or custom poster</summary>
    <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); onSave({ imdb: imdb.trim(), poster: poster.trim() }); }}>
      <label>IMDb ID <small>Looks up film details with your OMDb key.</small>
        <input className="glass" value={imdb} placeholder={film.imdb || 'tt0816692'} onChange={(event) => setImdb(event.target.value)} />
      </label>
      <label>Custom poster URL<input className="glass" type="url" value={poster} placeholder="https://" onChange={(event) => setPoster(event.target.value)} /></label>
      <button className="button glass primary" disabled={!imdb.trim() && !poster.trim()}><Save size={16} />Save metadata</button>
    </form>
    </details>
  </Modal>;
}

export function ManualFilm({ onClose, onAdd }) {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  return <Modal title="Add a film" onClose={onClose}>
    <h2>Add a film</h2><p className="modal-subtitle">Enter a title to save it to one of your watchlists.</p>
    <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); onAdd({ title: title.trim(), year }); }}>
      <label>Title<input className="glass" autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Release year<input className="glass" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={year} onChange={(event) => setYear(event.target.value)} /></label>
      <button className="button glass primary" disabled={!title.trim()}><Bookmark size={16} />Choose watchlist</button>
    </form>
  </Modal>;
}

export function Settings({ device, onClose, onUpdate, onToast, initialTab = 'drive' }) {
  const [tab, setTab] = useState(initialTab);
  const [moviePath, setMoviePath] = useState(device.moviePath);
  const [git, setGit] = useState(device.git);
  const [omdb, setOmdb] = useState('');
  const [legacy, setLegacy] = useState('');
  const [clearOmdb, setClearOmdb] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const filePicker = useRef(null);
  const bindGit = (key) => ({ value: git[key], onChange: (event) => setGit({ ...git, [key]: event.target.value }) });
  async function work(label, task) {
    setError('');
    setWorking(label);
    try { await task(); }
    catch (failure) { setError(failure.message); }
    finally { setWorking(''); }
  }
  async function save() {
    const next = await call('configure', { moviePath, git, omdb, clearOmdb });
    onUpdate(next);
    setOmdb('');
    setClearOmdb(false);
  }
  async function browse(kind, setPath) {
    const folder = await call('browse', { kind });
    if (folder) setPath(folder);
  }
  async function exportLibrary() {
    const state = await call('export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'carribean-library.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const tabOptions = [['drive', 'Library'], ['git', 'Git sync'], ['metadata', 'Metadata']];
  return <Modal title="Settings" className="settings-dialog" onClose={onClose}>
    <h2>Settings</h2>
    <GlassSegment label="Settings sections" choices={tabOptions} value={tab} onChange={(value) => { setTab(value); setError(''); }} className="settings-tabs" />
    <form className="dialog-form" onSubmit={(event) => {
      event.preventDefault();
      work('Saving', async () => { await save(); onToast('Settings saved'); onClose(); });
    }}>
      {tab === 'drive' && <>
        <label>Movie folder <small>Carribean scans this folder and all its subfolders.</small>
          <span className="field-row"><input className="glass" placeholder="D:\Movies" value={moviePath} onChange={(event) => setMoviePath(event.target.value)} />
            {device.canBrowse && <button type="button" className="button glass secondary" onClick={() => work('Opening folder picker', () => browse('movies', setMoviePath))}><FolderOpen size={17} />Browse</button>}
          </span>
        </label>
        <div className="settings-section">
          <h3>Move your collection</h3>
          <div className="dialog-actions">
            <button type="button" className="button glass secondary" onClick={() => work('Exporting', exportLibrary)}><Download size={17} />Export library</button>
            <button type="button" className="button glass secondary" onClick={() => filePicker.current.click()}><Upload size={17} />Import backup</button>
            <input type="file" ref={filePicker} accept=".json,application/json" hidden onChange={(event) => {
              const file = event.target.files[0];
              event.target.value = '';
              if (file) work('Importing', async () => {
                if (file.size > 16 * 1024 * 1024) throw new Error('The backup is larger than 16 MB.');
                const library = JSON.parse(await file.text());
                onUpdate(await call('import', { library }));
                onToast('Library backup imported');
              });
            }} />
          </div>
          <label>Import from the original app <small>Select its <code>backend</code> or <code>theatre-data</code> folder.</small>
            <span className="field-row"><input className="glass" value={legacy} onChange={(event) => setLegacy(event.target.value)} placeholder="Path to the old library" />
              {device.canBrowse && <button type="button" className="button glass secondary" onClick={() => work('Opening folder picker', () => browse('legacy', setLegacy))}>Browse</button>}
              <button type="button" className="button glass secondary" disabled={!legacy.trim() || !!working} onClick={() => work('Importing', async () => {
                const next = await call('importLegacy', { directory: legacy });
                onUpdate(next);
                setMoviePath(next.device.moviePath);
                onToast('Original library imported');
              })}>Import</button>
            </span>
          </label>
        </div>
      </>}
      {tab === 'git' && <>
        <p className="form-note">Sync film metadata, watched history, and watchlists to a Git repository. Use the same repository and branch on your next laptop, then select its movie folder.</p>
        <label>HTTPS repository URL<input className="glass" type="url" placeholder="https://github.com/you/film-library.git" {...bindGit('remote')} /></label>
        <label>Backup branch<input className="glass" placeholder="carribean-library" {...bindGit('branch')} /></label>
        <div className="field-pair"><label>Git author name<input className="glass" autoComplete="name" {...bindGit('name')} /></label>
          <label>Git author email<input className="glass" type="email" autoComplete="email" {...bindGit('email')} /></label></div>
        <label className="check-label"><input type="checkbox" checked={git.startup} onChange={(event) => setGit({ ...git, startup: event.target.checked })} />Sync with Git on startup</label>
        <p className="form-note">Git Credential Manager handles sign-in. Movie files and drive paths stay on this device.</p>
        <div className="dialog-actions">
          <button type="button" className="button glass secondary" disabled={!git.remote || !!working} onClick={() => work('Waiting for Git sign-in', async () => {
            await save(); await call('signIn'); onToast('Git sign-in saved');
          })}><GitBranch size={16} />Sign in to Git</button>
          <button type="button" className="button glass secondary" disabled={!git.remote || !!working} onClick={() => work('Syncing', async () => {
            await save(); onUpdate(await call('sync')); onToast('Library synced');
          })}><RefreshCw size={16} />Sync now</button>
        </div>
        {device.lastSync && <p className="form-note">Last Git sync {new Date(device.lastSync).toLocaleString()}</p>}
      </>}
      {tab === 'metadata' && <>
        <label>OMDb API key <small>Enables online film search and fills missing metadata after a sync.</small>
          <input className="glass" type="password" placeholder={device.hasOmdb ? 'A key is configured' : 'Enter your key'} value={omdb} onChange={(event) => { setOmdb(event.target.value); setClearOmdb(false); }} />
        </label>
        {device.hasOmdb && <label className="check-label"><input type="checkbox" checked={clearOmdb} onChange={(event) => { setClearOmdb(event.target.checked); setOmdb(''); }} />Remove the saved key</label>}
        <a className="form-link" href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">Request an OMDb key <ExternalLink size={14} /></a>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="settings-footer"><span role="status">{working && working + '…'}</span><button disabled={!!working} className="button glass primary"><Check size={17} />Save settings</button></div>
    </form>
  </Modal>;
}
