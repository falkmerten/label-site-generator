'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { loadContent } = require('../../src/content');

async function mkdirp(p) {
  await fs.mkdir(p, { recursive: true });
}

async function touch(p, content = '') {
  await fs.writeFile(p, content);
}

async function withTmpDir(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'content-test-'));
  try {
    return await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

describe('loadContent', () => {
  test('returns empty store when contentDir does not exist', async () => {
    const result = await loadContent('/nonexistent/path/xyz');
    expect(result).toEqual(expect.objectContaining({ global: {}, artists: {}, pages: {} }));
  });

  test('returns empty store for empty contentDir', async () => {
    await withTmpDir(async (tmp) => {
      const result = await loadContent(tmp);
      expect(result).toEqual(expect.objectContaining({ global: {}, artists: {}, pages: {} }));
      expect(result._contentDir).toBe(tmp);
    });
  });

  test('picks up global cssPath, faviconPath, logoPath', async () => {
    await withTmpDir(async (tmp) => {
      const globalDir = path.join(tmp, 'global');
      await mkdirp(globalDir);
      await touch(path.join(globalDir, 'style.css'));
      await touch(path.join(globalDir, 'favicon.ico'));
      await touch(path.join(globalDir, 'logo.png'));

      const result = await loadContent(tmp);
      expect(result.global.cssPath).toBe(path.join(globalDir, 'style.css'));
      expect(result.global.faviconPath).toBe(path.join(globalDir, 'favicon.ico'));
      expect(result.global.logoPath).toBe(path.join(globalDir, 'logo.png'));
    });
  });

  test('global fields are optional when files are absent', async () => {
    await withTmpDir(async (tmp) => {
      await mkdirp(path.join(tmp, 'global'));
      const result = await loadContent(tmp);
      expect(result.global.cssPath).toBeUndefined();
      expect(result.global.faviconPath).toBeUndefined();
      expect(result.global.logoPath).toBeUndefined();
    });
  });

  test('loads artist bioPath and photoPath', async () => {
    await withTmpDir(async (tmp) => {
      const artistDir = path.join(tmp, 'some-artist');
      await mkdirp(artistDir);
      await touch(path.join(artistDir, 'bio.md'));
      await touch(path.join(artistDir, 'photo.jpg'));

      const result = await loadContent(tmp);
      expect(result.artists['some-artist'].bioPath).toBe(path.join(artistDir, 'bio.md'));
      expect(result.artists['some-artist'].photoPath).toBe(path.join(artistDir, 'photo.jpg'));
    });
  });

  test('parses meta.json for artist', async () => {
    await withTmpDir(async (tmp) => {
      const artistDir = path.join(tmp, 'my-artist');
      await mkdirp(artistDir);
      await touch(path.join(artistDir, 'meta.json'), JSON.stringify({ name: 'My Artist', city: 'Berlin' }));

      const result = await loadContent(tmp);
      expect(result.artists['my-artist'].meta).toEqual({ name: 'My Artist', city: 'Berlin' });
    });
  });

  test('skips meta.json when JSON is invalid', async () => {
    await withTmpDir(async (tmp) => {
      const artistDir = path.join(tmp, 'bad-meta');
      await mkdirp(artistDir);
      await touch(path.join(artistDir, 'meta.json'), 'not json {{{');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadContent(tmp);
      expect(result.artists['bad-meta'].meta).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  test('loads album notesPath and artworkPath', async () => {
    await withTmpDir(async (tmp) => {
      const albumDir = path.join(tmp, 'artist-a', 'album-one');
      await mkdirp(albumDir);
      await touch(path.join(albumDir, 'notes.md'));
      await touch(path.join(albumDir, 'artwork.png'));

      const result = await loadContent(tmp);
      const album = result.artists['artist-a'].albums['album-one'];
      expect(album.notesPath).toBe(path.join(albumDir, 'notes.md'));
      expect(album.artworkPath).toBe(path.join(albumDir, 'artwork.png'));
    });
  });

  test('photo first-match wins across extensions', async () => {
    await withTmpDir(async (tmp) => {
      const artistDir = path.join(tmp, 'ext-test');
      await mkdirp(artistDir);
      // only .webp present
      await touch(path.join(artistDir, 'photo.webp'));

      const result = await loadContent(tmp);
      expect(result.artists['ext-test'].photoPath).toBe(path.join(artistDir, 'photo.webp'));
    });
  });

  test('global directory is not treated as an artist', async () => {
    await withTmpDir(async (tmp) => {
      await mkdirp(path.join(tmp, 'global'));
      const result = await loadContent(tmp);
      expect(result.artists['global']).toBeUndefined();
    });
  });
});
