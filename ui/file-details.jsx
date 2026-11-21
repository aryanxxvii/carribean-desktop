import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { call } from './api';
import { fileSize } from './components';
import { FormatMark } from './format-mark';
import { formatMarks as marks } from './media-formats';

const languages = new Intl.DisplayNames(navigator.languages, { type: 'language' });

function languageOf(code) {
  if (!code || code === 'und') return '';
  try { return languages.of(code); } catch { return code; }
}

function audioBadge(format) {
  if (format.startsWith('Dolby Atmos ·')) return { label: 'Dolby Atmos', mark: 'Dolby Atmos', priority: 5 };
  if (format.startsWith('DTS')) {
    const profile = format.replace(/ · DTS:X tagged$/, '');
    if (profile.includes('DTS:X')) return { label: 'DTS:X', mark: 'DTS', suffix: ':X', priority: 5 };
    if (/DTS-HD.*(?:MA|Master Audio)/i.test(profile)) return { label: 'DTS-HD Master Audio', mark: 'DTS', suffix: 'HD MA', priority: 4 };
    if (profile.startsWith('DTS-HD')) return { label: profile, mark: 'DTS', suffix: 'HD', priority: 3 };
    return { label: profile, mark: 'DTS', priority: 2 };
  }
  const label = format.split(' · ')[0];
  return { label, mark: marks[label] ? label : undefined, priority: 0 };
}

function mediaBadges(file) {
  if (!file) return [];
  const audio = (file.audioFormats || file.audio?.map((track) => track.format) || [])
    .filter(Boolean).map(audioBadge).sort((a, b) => b.priority - a.priority);
  const bestDts = audio.find((badge) => badge.mark === 'DTS');
  const atmosphere = audio.find((badge) => badge.mark === 'Dolby Atmos');
  const audioMarks = [atmosphere, bestDts].filter(Boolean);
  if (!audioMarks.length && audio[0]) audioMarks.push(audio[0]);
  return [
    file.resolution && { label: file.resolution, title: 'Resolution' },
    file.edition && { label: file.edition, mark: 'IMAX', suffix: file.edition === 'IMAX Enhanced' ? 'Enhanced' : '', title: 'Edition tag' },
    ...(file.formats || []).filter((format) => format !== 'SDR').map((format) => ({
      label: format, mark: marks[format] ? format : undefined
    })),
    ...audioMarks,
    file.aspect && { label: file.aspect, title: 'Encoded aspect ratio' },
    Number.isFinite(file.size) && { label: fileSize(file.size), title: 'File size' }
  ].filter(Boolean);
}

export function FilmFile({ id, cached }) {
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState(undefined);
  const shouldRead = file === undefined && (expanded || !cached);
  useEffect(() => {
    if (!shouldRead) return;
    let active = true;
    void call('fileDetails', { id }).catch(() => null).then((next) => {
      if (active) setFile(next);
    });
    return () => { active = false; };
  }, [id, shouldRead]);

  const info = file || cached;
  const badges = mediaBadges(info);
  const facts = [
    ['Size', fileSize(info?.size)],
    ['Resolution', file?.width ? `${file.resolution} · ${file.width} × ${file.height}` : info?.resolution],
    ['Aspect ratio', info?.aspect],
    ['Edition', info?.edition && info.edition + ' (tagged)'],
    ['Video', [file?.videoCodec, ...(info?.formats || [])].filter(Boolean).join(' · ')],
    ['Container', file?.container]
  ].filter(([, value]) => value);

  return <details className="file-specs" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="file-badges">
      {(badges.length ? badges : [{ label: 'File details' }]).map(({ label, mark, suffix, title }, index) => <span key={label}
        className={'format-badge' + (index === Math.max(0, badges.length - 1) ? ' format-badge-toggle' : '')}
        title={title ? `${title} · ${label}` : label}>
        <FormatMark label={label} mark={mark} suffix={suffix} />
        {index === Math.max(0, badges.length - 1) && <ChevronDown className="file-toggle" size={11} aria-hidden="true" />}
      </span>)}
      {!!badges.length && <span className="sr-only">File details</span>}
    </summary>
    <section className="file-inspector" aria-label="Technical details">
      {!!facts.length && <dl>{facts.map(([label, value]) => <div key={label}><dt
        title={label === 'Aspect ratio' ? 'Encoded video frame, which can include letterboxing.' : undefined}>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {file === undefined && <p className="form-note" role="status">Reading file details…</p>}
      {file === null && <p className="form-note">File details unavailable.</p>}
      {file?.unavailable && <p className="form-note">FFprobe is needed to read stream details.</p>}
      {file && !file.width && !file.unavailable && <p className="form-note">Video stream details could not be read.</p>}
      {!!file?.audio?.length && <ul className="file-tracks" aria-label="Audio tracks">{file.audio.map((track, index) => <li key={index}>
        <strong>{track.format || 'Unknown audio format'}</strong>
        <span>{[languageOf(track.language), track.layout || (track.channels && track.channels + ' ch'), track.title, track.default && 'Default'].filter(Boolean).join(' · ')}</span>
      </li>)}</ul>}
    </section>
  </details>;
}
