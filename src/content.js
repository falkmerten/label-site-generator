'use strict';

const fs = require('fs/promises');
const path = require('path');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFirstFile(dir, basenames) {
  for (const name of basenames) {
    const full = path.join(dir, name);
    if (await exists(full)) return full;
  }
  return undefined;
}

async function loadContent(contentDir) {
  const store = { global: {}, artists: {}, pages: {}, _contentDir: contentDir };

  if (!(await exists(contentDir))) {
    return store;
  }

  // --- global ---
  const globalDir = path.join(contentDir, 'global');
  if (await exists(globalDir)) {
    const cssPath = await findFirstFile(globalDir, ['style.css']);
    if (cssPath) store.global.cssPath = cssPath;

    const faviconPath = await findFirstFile(globalDir, ['favicon.ico', 'favicon.png']);
    if (faviconPath) store.global.faviconPath = faviconPath;

    const logoPath = await findFirstFile(globalDir, ['logo.png', 'logo.svg']);
    if (logoPath) store.global.logoPath = logoPath;
  }

  // --- pages: scan content/pages/ for any .md files ---
  const pagesDir = path.join(contentDir, 'pages');
  if (await exists(pagesDir)) {
    const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true }).catch(() => [])
    for (const entry of pageEntries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (ext === '.md') {
        const name = path.basename(entry.name, '.md')
        const filePath = path.join(pagesDir, entry.name)
        // Read front-matter for menu placement
        let menu = 'footer' // default
        try {
          const raw = await fs.readFile(filePath, 'utf8')
          const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/)
          if (fmMatch) {
            const menuMatch = fmMatch[1].match(/^menu:\s*(.+)$/m)
            if (menuMatch) menu = menuMatch[1].trim()
          }
        } catch { /* ignore */ }
        store.pages[name] = { path: filePath, menu }
      }
    }
  }

  // --- artists ---
  let topEntries;
  try {
    topEntries = await fs.readdir(contentDir, { withFileTypes: true });
  } catch {
    return store;
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory() || entry.name === 'global') continue;

    const artistSlug = entry.name;
    const artistDir = path.join(contentDir, artistSlug);
    const artist = { albums: {} };

    // bio
    const bioPath = path.join(artistDir, 'bio.md');
    if (await exists(bioPath)) artist.bioPath = bioPath;

    // photo
    const photoPath = await findFirstFile(artistDir, IMAGE_EXTS.map(e => `photo${e}`));
    if (photoPath) artist.photoPath = photoPath;

    // gallery images (content/{slug}/images/*.jpg etc.)
    const imagesDir = path.join(artistDir, 'images');
    if (await exists(imagesDir)) {
      try {
        const imgEntries = await fs.readdir(imagesDir, { withFileTypes: true });
        artist.galleryImages = imgEntries
          .filter(e => e.isFile() && IMAGE_EXTS.includes(path.extname(e.name).toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => path.join(imagesDir, e.name));
      } catch { /* ignore */ }
    }

    // meta.json
    const metaPath = path.join(artistDir, 'meta.json');
    if (await exists(metaPath)) {
      try {
        const raw = await fs.readFile(metaPath, 'utf8');
        artist.meta = JSON.parse(raw);
      } catch {
        console.warn(`[content] Failed to parse ${metaPath}, skipping.`);
      }
    }

    // links.json — manual social/streaming/website links override
    const linksPath = path.join(artistDir, 'links.json');
    if (await exists(linksPath)) {
      try {
        const raw = await fs.readFile(linksPath, 'utf8');
        artist.links = JSON.parse(raw);
      } catch {
        console.warn(`[content] Failed to parse ${linksPath}, skipping.`);
      }
    }

    // albums
    let artistEntries;
    try {
      artistEntries = await fs.readdir(artistDir, { withFileTypes: true });
    } catch {
      artistEntries = [];
    }

    for (const ae of artistEntries) {
      if (!ae.isDirectory()) continue;

      const albumSlug = ae.name;
      const albumDir = path.join(artistDir, albumSlug);
      const album = {};

      const notesPath = path.join(albumDir, 'notes.md');
      if (await exists(notesPath)) album.notesPath = notesPath;

      const reviewsPath = path.join(albumDir, 'reviews.md');
      if (await exists(reviewsPath)) album.reviewsPath = reviewsPath;

      const artworkPath = await findFirstFile(albumDir, IMAGE_EXTS.map(e => `artwork${e}`));
      if (artworkPath) album.artworkPath = artworkPath;

      // videos.json
      const videosPath = path.join(albumDir, 'videos.json');
      if (await exists(videosPath)) {
        try {
          const raw = await fs.readFile(videosPath, 'utf8');
          album.videos = JSON.parse(raw);
        } catch {
          console.warn(`[content] Failed to parse ${videosPath}, skipping.`);
        }
      }

      // stores.json — custom physical store links
      const storesPath = path.join(albumDir, 'stores.json');
      if (await exists(storesPath)) {
        try {
          const raw = await fs.readFile(storesPath, 'utf8');
          album.customStores = JSON.parse(raw);
        } catch {
          console.warn(`[content] Failed to parse ${storesPath}, skipping.`);
        }
      }

      artist.albums[albumSlug] = album;
    }

    store.artists[artistSlug] = artist;
  }

  return store;
}

module.exports.loadContent = loadContent;
