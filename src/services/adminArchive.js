import { isForbidden, isTakenDown } from './policy.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const VIDEO_FILE = /\.(?:mp4|m4v|mkv|avi|mov|webm|ogv|mpeg|mpg|wmv)$/i;

function textValue(value, max = 2000) {
  const first = Array.isArray(value) ? value[0] : value;
  return String(first ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseArchiveIdentifier(input) {
  const raw = String(input ?? '').trim();
  if (IDENTIFIER.test(raw)) return raw;

  let url;
  try { url = new URL(raw); } catch {
    throw new Error('Enter an Archive.org item identifier or a valid Archive.org details link.');
  }
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['archive.org', 'www.archive.org'].includes(url.hostname.toLowerCase())) {
    throw new Error('Only links from archive.org are accepted.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || !['details', 'embed'].includes(parts[0]) || !IDENTIFIER.test(parts[1])) {
    throw new Error('Use an Archive.org item link such as https://archive.org/details/item-identifier.');
  }
  return parts[1];
}

export function normalizeArchiveItem(response, expectedIdentifier) {
  const metadata = response?.metadata;
  const identifier = textValue(metadata?.identifier, 200);
  if (!metadata || !identifier || identifier !== expectedIdentifier) {
    throw new Error('Archive.org could not find that item.');
  }
  if (isTakenDown(identifier)) {
    throw new Error('This item is on the site takedown list and cannot be added.');
  }
  if (String(metadata.mediatype || '').toLowerCase() !== 'movies') {
    throw new Error('This Archive.org item is not catalogued as a movie/video item.');
  }

  const files = Array.isArray(response.files) ? response.files : [];
  const videoFiles = files.filter(file => VIDEO_FILE.test(String(file?.name || '')) &&
    !String(file.name).startsWith('__MACOSX/') && Number(file.size || 0) > 0);
  if (!videoFiles.length) {
    throw new Error('No supported video file was found in this Archive.org item.');
  }

  const title = textValue(metadata.title, 180) || identifier;
  const description = textValue(metadata.description, 2000);
  const subjects = [].concat(metadata.subject || []).map(value => textValue(value, 80)).filter(Boolean).slice(0, 12);
  if (isForbidden({ title, description, subject: subjects })) {
    throw new Error('This item is blocked by the website content policy and cannot be added.');
  }
  const yearText = textValue(metadata.year || metadata.date, 30);
  const yearMatch = yearText.match(/\b(?:18|19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  return {
    identifier,
    title,
    description,
    year,
    genre: subjects.slice(0, 4).join(' · '),
    poster_url: 'https://archive.org/services/img/' + encodeURIComponent(identifier),
    archive_url: 'https://archive.org/details/' + encodeURIComponent(identifier),
    runtime: textValue(metadata.runtime, 40),
    video_files: videoFiles.length,
    file_size: videoFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
  };
}
