import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const videos = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm', '.wmv', '.flv', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts']);

// Carribean's original naming conventions, plus releases ending directly in the year.
export function parseFilename(fileName) {
  const base = path.parse(fileName).name;
  const match = base.match(/^(.*?)\s*\((\d{4})\)(?:[ ._\[-].*)?$/)
    || base.match(/^(.*?)[. ]((?:18|19|20)\d{2})(?:[. ].*)?$/);
  return { title: (match?.[1] || base).replace(/[._]/g, ' ').trim(), year: match?.[2] || '' };
}

export const filmId = (title, year) => 'film-' + createHash('sha256')
  .update(title.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') + '|' + (String(year).match(/\d{4}/)?.[0] || ''))
  .digest('hex').slice(0, 24);

export async function scanDirectory(root) {
  const files = [];
  let skipped = 0;
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (dir === root) throw error;
      skipped++;
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (!entry.isFile() || !videos.has(path.extname(entry.name).toLowerCase())) continue;
      if (/^(sample|trailer)([ ._-]|$)/i.test(entry.name)) continue;
      const film = parseFilename(entry.name);
      files.push({ ...film, id: filmId(film.title, film.year), fullPath });
    }
  };
  await walk(root);
  return { files, skipped };
}
