import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export function editionBadge(file) {
  if (file.edition) return { edition: file.edition, editionSource: 'tag' };
  if (['1.90:1', '1.43:1'].includes(file.aspect)) return { edition: 'IMAX', editionSource: 'ratio' };
  return { edition: '' };
}
const rationals = (value) => {
  const [a, b] = String(value || '').split(':').map(Number);
  return a > 0 && b > 0 ? a / b : 0;
};
const videoNames = { av1: 'AV1', hevc: 'HEVC', h264: 'H.264', vp9: 'VP9', mpeg2video: 'MPEG-2', vc1: 'VC-1' };
const audioNames = { ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', aac: 'AAC', flac: 'FLAC', opus: 'Opus', alac: 'ALAC', mp3: 'MP3' };

function audioTrack(stream) {
  const profile = stream.profile || '';
  const title = stream.tags?.title || '';
  let format = audioNames[stream.codec_name] || stream.codec_name?.toUpperCase() || '';
  if (stream.codec_name === 'dts') {
    format = profile.startsWith('DTS') ? profile : 'DTS';
    if (/\bDTS:X\b/i.test(title) && !format.includes('DTS:X')) format += ' · DTS:X tagged';
  }
  if (/\batmos\b/i.test(profile)) format = 'Dolby Atmos · ' + format;
  else if (/\batmos\b/i.test(title) && ['truehd', 'eac3'].includes(stream.codec_name)) format += ' · Atmos tagged';
  return {
    format, title, language: stream.tags?.language || '', channels: stream.channels || 0,
    layout: /^\d\.\d(?:\.\d)?/.exec(stream.channel_layout || '')?.[0] || '',
    default: stream.disposition?.default === 1
  };
}

export function describeMedia(report, file, size) {
  const streams = report?.streams || [];
  const video = streams.filter((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic && stream.width && stream.height)
    .sort((a, b) => (b.disposition?.default || 0) - (a.disposition?.default || 0) || b.width * b.height - a.width * a.height)[0];
  const audio = streams.filter((stream) => stream.codec_type === 'audio').map(audioTrack);
  const name = path.basename(file);
  const variant = /\bIMAX(?:[ ._-]+Enhanced)?\b/i.exec([name, report?.format?.tags?.title, video?.tags?.title].filter(Boolean).join(' '));
  const edition = variant ? (/enhanced/i.test(variant[0]) ? 'IMAX Enhanced' : 'IMAX') : '';
  const result = { size, name, container: path.extname(name).slice(1).toUpperCase(), edition, audio };
  if (!video) return result;
  const { width, height } = video;
  const aspect = rationals(video.display_aspect_ratio) || width * (rationals(video.sample_aspect_ratio) || 1) / height;
  const resolution = width >= 7400 || height >= 4100 ? '8K' : width >= 3600 || height >= 2050 ? '4K'
    : width >= 2450 || height >= 1380 ? '1440p' : width >= 1800 || height >= 1000 ? '1080p'
      : width >= 1200 || height >= 700 ? '720p' : height + 'p';
  const sideData = video.side_data_list || [];
  const hasSideData = (pattern) => sideData.some((entry) => pattern.test(entry.side_data_type || ''));
  const formats = [];
  if (hasSideData(/DOVI|Dolby Vision/i) || /^(dvhe|dvh1|dvav|dva1)$/i.test(video.codec_tag_string || '')) formats.push('Dolby Vision');
  if (hasSideData(/2094-40|HDR10\+/i)) formats.push('HDR10+');
  else if (video.color_transfer === 'smpte2084' && video.color_primaries === 'bt2020') formats.push('HDR10');
  else if (video.color_transfer === 'smpte2084') formats.push('HDR (PQ)');
  if (video.color_transfer === 'arib-std-b67') formats.push('HLG');
  if (!formats.length && /^(bt709|smpte170m|iec61966-2-1|gamma22|gamma28)$/.test(video.color_transfer || '')) formats.push('SDR');
  return { ...result, width, height, resolution, aspect: aspect.toFixed(2) + ':1', formats,
    videoCodec: videoNames[video.codec_name] || video.codec_name?.toUpperCase() || '' };
}

export function createMediaReader(store) {
  const inflight = new Map();
  let unavailable = false;
  const signature = (info) => [1, info.size, info.mtimeMs].join(':');

  function inspect(file, info) {
    const version = signature(info);
    const key = file + '|' + version;
    if (inflight.has(key)) return inflight.get(key);
    const analysis = (async () => {
      if (unavailable) return null;
      try {
        const { stdout } = await run('ffprobe', [
          '-v', 'error', '-protocol_whitelist', 'file', '-analyzeduration', '4000000', '-probesize', '4000000',
          '-show_streams', '-show_format', '-of', 'json', '-i', file
        ], { timeout: 9000, windowsHide: true, maxBuffer: 2_000_000 });
        return { source: file, version, ...describeMedia(JSON.parse(stdout), file, info.size) };
      } catch (error) {
        if (error.code === 'ENOENT') unavailable = true;
        return null;
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, analysis);
    return analysis;
  }

  const matches = (record, { absolute, info }) => record?.source === absolute && record.version === signature(info);
  return {
    async details(id, movie) {
      const record = (await store.media())[id];
      if (matches(record, movie)) return record;
      const result = await inspect(movie.absolute, movie.info);
      if (result) await store.updateMedia({ [id]: result }).catch(() => {});
      return result || { ...describeMedia(null, movie.absolute, movie.info.size), unavailable };
    },
    async refresh(ids, movieById) {
      const records = await store.media();
      const updates = {};
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(ids.length, 3) }, async () => {
        while (index < ids.length && !unavailable) {
          const id = ids[index++];
          const movie = await movieById(id);
          if (!movie || matches(records[id], movie)) continue;
          const result = await inspect(movie.absolute, movie.info);
          if (result) updates[id] = result;
        }
      }));
      if (Object.keys(updates).length) await store.updateMedia(updates);
    }
  };
}
