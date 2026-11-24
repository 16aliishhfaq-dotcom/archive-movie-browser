import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArchiveItem, parseArchiveIdentifier } from './adminArchive.js';

test('accepts a plain Archive.org identifier', () => {
  assert.equal(parseArchiveIdentifier('classic-film_1930'), 'classic-film_1930');
});

test('accepts details and embed links, including harmless query strings', () => {
  assert.equal(parseArchiveIdentifier('https://archive.org/details/classic-film?view=theater'), 'classic-film');
  assert.equal(parseArchiveIdentifier('https://www.archive.org/embed/classic-film'), 'classic-film');
});

test('rejects non-Archive hosts and malformed item paths', () => {
  assert.throws(() => parseArchiveIdentifier('https://archive.org.evil.example/details/film'), /Only links from archive.org/);
  assert.throws(() => parseArchiveIdentifier('https://example.com/details/film'), /Only links from archive.org/);
  assert.throws(() => parseArchiveIdentifier('https://archive.org/details/film/video.mp4'), /Use an Archive.org item link/);
  assert.throws(() => parseArchiveIdentifier('not a url or identifier'), /valid Archive.org details link/);
});

test('normalizes real item metadata and video file information', () => {
  const item = normalizeArchiveItem({
    metadata: {
      identifier: 'classic-film', mediatype: 'movies', title: 'Classic Film',
      description: 'A restored feature.', year: '1936', runtime: '1:24:10',
      subject: ['Drama', 'Silent film'],
    },
    files: [
      { name: 'readme.txt', size: '100' },
      { name: 'classic-film.mp4', size: '120000000', format: 'MPEG4' },
      { name: 'classic-film.srt', size: '2000' },
    ],
  }, 'classic-film');
  assert.equal(item.identifier, 'classic-film');
  assert.equal(item.title, 'Classic Film');
  assert.equal(item.year, 1936);
  assert.equal(item.runtime, '1:24:10');
  assert.equal(item.video_files, 1);
  assert.equal(item.file_size, 120000000);
  assert.equal(item.archive_url, 'https://archive.org/details/classic-film');
});

test('rejects non-movie items', () => {
  assert.throws(() => normalizeArchiveItem({
    metadata: { identifier: 'a-book', mediatype: 'texts', title: 'A Book' },
    files: [{ name: 'book.pdf', size: '500' }],
  }, 'a-book'), /not catalogued as a movie\/video/);
});

test('rejects items with no supported video files', () => {
  assert.throws(() => normalizeArchiveItem({
    metadata: { identifier: 'no-video', mediatype: 'movies', title: 'No Video' },
    files: [{ name: 'poster.jpg', size: '500' }],
  }, 'no-video'), /No supported video file/);
});

test('rejects items on the site's takedown list', () => {
  assert.throws(() => normalizeArchiveItem({
    metadata: { identifier: 'orphanedfilms-takedown-test', mediatype: 'movies', title: 'Removed item' },
    files: [{ name: 'film.mp4', size: '100' }],
  }, 'orphanedfilms-takedown-test'), /takedown list/);
});

test('rejects blocked content and identifier mismatches', () => {
  assert.throws(() => normalizeArchiveItem({
    metadata: { identifier: 'unsafe-item', mediatype: 'movies', title: 'Rape archive footage' },
    files: [{ name: 'film.mp4', size: '100' }],
  }, 'unsafe-item'), /blocked by the website content policy/);
  assert.throws(() => normalizeArchiveItem({
    metadata: { identifier: 'different-item', mediatype: 'movies', title: 'Film' },
    files: [{ name: 'film.mp4', size: '100' }],
  }, 'expected-item'), /could not find that item/);
});
