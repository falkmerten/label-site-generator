'use strict';

const fs = require('fs/promises');
const path = require('path');
const nunjucks = require('nunjucks');
const { renderMarkdown } = require('./markdown');

/**
 * Render the full static site from merged site data.
 * @param {object} data - MergedSiteData
 * @param {object} pages - map of page name → markdown file path (from content.pages)
 * @param {string} outputDir - Directory to write rendered HTML files into
 * @returns {Promise<number>} Total number of pages written
 */
async function renderSite(data, pages, outputDir, labelName) {
  labelName = labelName || process.env.LABEL_NAME || 'My Label';
  const siteUrl = (process.env.SITE_URL || '').replace(/\/?$/, '/'); // ensure trailing slash
  const gaMeasurementId = process.env.GA_MEASUREMENT_ID || '';
  const physicalStores = (process.env.PHYSICAL_STORES || 'bandcamp,discogs').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const homepageLabels = (process.env.HOMEPAGE_LABELS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  // Build custom store definitions from env vars: STORE_{ID}_URL, STORE_{ID}_LABEL, STORE_{ID}_ICON
  const customStoreDefs = {}
  for (const [key, val] of Object.entries(process.env)) {
    const m = key.match(/^STORE_([A-Z0-9]+)_URL$/i)
    if (m) {
      const id = m[1].toLowerCase()
      customStoreDefs[id] = {
        id,
        url: val,
        label: process.env[`STORE_${m[1]}_LABEL`] || `Buy at ${m[1]}`,
        icon: process.env[`STORE_${m[1]}_ICON`] || 'fa-solid fa-store'
      }
    }
  }
  const templatesDir = path.join(__dirname, '..', 'templates');
  const env = nunjucks.configure(templatesDir, { autoescape: true });

  // Custom filter: check if a URL is a local file (not http/https)
  env.addFilter('isLocal', (url) => url && !url.startsWith('http'));

  // Custom filter: URL-encode a string
  env.addFilter('urlencode', (str) => encodeURIComponent(str || ''));

  // Custom filter: resolve store URL template with artist and album name
  env.addFilter('storeUrl', (template, artistName, albumTitle) => {
    return (template || '')
      .replace(/\{artist\}/g, encodeURIComponent(artistName || ''))
      .replace(/\{album\}/g, encodeURIComponent(albumTitle || ''))
  });

  // Custom filter: compute available format labels for an album card
  // Digital is always included. Physical formats (Vinyl, CD etc.) are prepended if available.
  // Label name is appended if present.
  env.addFilter('availableFormats', (album) => {
    const physical = album.physicalFormats || []
    const formats = []
    if (physical.includes('Vinyl')) formats.push('Vinyl')
    if (physical.includes('CD')) formats.push('CD')
    if (physical.includes('Cassette')) formats.push('Cassette')
    if (physical.includes('Box Set')) formats.push('Box Set')
    formats.push('Digital')
    let result = formats.join(', ')
    if (album.labelName) result += ' — ' + album.labelName
    return result
  });
  env.addFilter('youtubeId', (url) => {
    if (!url) return ''
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    return m ? m[1] : ''
  });

  // Custom filter: convert newlines to <br> tags (handles \r\n and \n)
  env.addFilter('nl2br', (str) => str ? str.replace(/\r\n|\r|\n/g, '<br>') : '');

  // Custom filter: format ISO date string to readable date
  env.addFilter('formatDate', (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  let count = 0;

  // Load optional page content
  async function loadPage(name) {
    const page = pages[name]
    if (!page) return null
    const filePath = typeof page === 'string' ? page : page.path
    if (filePath) {
      try {
        let md = await fs.readFile(filePath, 'utf8');
        // Strip front-matter before rendering
        md = md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
        return renderMarkdown(md);
      } catch { /* ignore */ }
    }
    return null;
  }

  const newsHtml = await loadPage('news');
  const aboutHtml = await loadPage('about');

  // Discover all extra pages (anything in pages/ that isn't news/about)
  const CORE_PAGES = new Set(['news', 'about', 'imprint', 'contact'])

  function pageInfo (name) {
    const page = pages[name]
    const menu = (page && typeof page === 'object') ? (page.menu || 'footer') : 'footer'
    return {
      name,
      title: name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' '),
      slug: name,
      menu
    }
  }

  // Built-in pages with content
  const builtinPages = ['imprint', 'contact']
    .filter(n => pages[n])
    .map(pageInfo)

  // Extra pages
  const extraPages = Object.keys(pages)
    .filter(name => !CORE_PAGES.has(name))
    .map(pageInfo)

  const allNavPages = [...builtinPages, ...extraPages]
  const mainNavPages = allNavPages.filter(p => p.menu === 'main' || p.menu === 'both')
  const footerNavPages = allNavPages.filter(p => p.menu === 'footer' || p.menu === 'both' || p.menu === 'main')

  // Collect all albums across all artists, sorted newest first
  const allAlbums = [];
  for (const artist of data.artists || []) {
    for (const album of artist.albums || []) {
      allAlbums.push({ ...album, artistName: artist.name, artistSlug: artist.slug });
    }
  }
  allAlbums.sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return 0;
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return new Date(b.releaseDate) - new Date(a.releaseDate);
  });

  // Filter albums for homepage/releases page by label if configured
  const homepageAlbums = homepageLabels.length > 0
    ? allAlbums.filter(al => {
        if (!al.labelName) return true // show albums without label (benefit of doubt)
        const labels = al.labelName.toLowerCase().split('/').map(s => s.trim())
        return labels.some(l => homepageLabels.includes(l))
      })
    : allAlbums;

  // Sort artists alphabetically
  const sortedArtists = [...(data.artists || [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const baseCtx = {
    artists: sortedArtists,
    labelName,
    siteUrl,
    gaMeasurementId,
    physicalStores,
    customStoreDefs,
    currentYear: new Date().getFullYear(),
    newsletter: {
      actionUrl: process.env.NEWSLETTER_ACTION_URL || '',
      listId: process.env.NEWSLETTER_LIST_ID || '',
      doubleOptIn: (process.env.NEWSLETTER_DOUBLE_OPTIN || '').toLowerCase() === 'true'
    },
    latestReleases: homepageAlbums.slice(0, 12),
    totalReleases: homepageAlbums.length,
    labelBandcampUrl: process.env.BANDCAMP_LABEL_URL || process.env.LABEL_BANDCAMP_URL || '',
    labelEmail: process.env.LABEL_EMAIL || '',
    labelAddress: process.env.LABEL_ADDRESS || '',
    labelVatId: process.env.LABEL_VAT_ID || '',
    extraPages,
    mainNavPages,
    footerNavPages,
    pages,
    social: {
      bandcamp:   process.env.BANDCAMP_LABEL_URL || process.env.LABEL_BANDCAMP_URL || '',
      spotify:    process.env.LABEL_SPOTIFY_URL || '',
      soundcloud: process.env.LABEL_SOUNDCLOUD_URL || '',
      youtube:    process.env.LABEL_YOUTUBE_URL || '',
      instagram:  process.env.LABEL_INSTAGRAM_URL || '',
      facebook:   process.env.LABEL_FACEBOOK_URL || '',
      tiktok:     process.env.LABEL_TIKTOK_URL || '',
      twitter:    process.env.LABEL_TWITTER_URL || '',
    },
  };

  // --- index ---
  await fs.mkdir(outputDir, { recursive: true });
  const sitemapUrls = [];
  const indexHtml = nunjucks.render('index.njk', {
    ...baseCtx,
    allAlbums: homepageAlbums,
    newsHtml,
    aboutHtml,
    rootPath: './',
    canonicalUrl: siteUrl || null,
  });
  await fs.writeFile(path.join(outputDir, 'index.html'), indexHtml, 'utf8');
  if (siteUrl) sitemapUrls.push({ url: siteUrl, priority: '1.0' });
  count++;

  // --- artist + album pages ---
  for (const artist of data.artists || []) {
    const artistDir = path.join(outputDir, 'artists', artist.slug);
    await fs.mkdir(artistDir, { recursive: true });
    const artistUrl = siteUrl ? `${siteUrl}artists/${artist.slug}/` : null;

    const artistHtml = nunjucks.render('artist.njk', {
      ...baseCtx,
      artist: {
        ...artist,
        albums: [...(artist.albums || [])].sort((a, b) => {
          if (!a.releaseDate && !b.releaseDate) return 0;
          if (!a.releaseDate) return 1;
          if (!b.releaseDate) return -1;
          return new Date(b.releaseDate) - new Date(a.releaseDate);
        })
      },
      rootPath: '../../',
      canonicalUrl: artistUrl,
    });
    await fs.writeFile(path.join(artistDir, 'index.html'), artistHtml, 'utf8');
    if (artistUrl) sitemapUrls.push({ url: artistUrl, priority: '0.8' });
    count++;

    for (const album of artist.albums || []) {
      const albumDir = path.join(outputDir, 'artists', artist.slug, album.slug);
      await fs.mkdir(albumDir, { recursive: true });
      const albumUrl = siteUrl ? `${siteUrl}artists/${artist.slug}/${album.slug}/` : null;

      const albumHtml = nunjucks.render('album.njk', {
        ...baseCtx,
        album,
        artist,
        rootPath: '../../../',
        canonicalUrl: albumUrl,
      });
      await fs.writeFile(path.join(albumDir, 'index.html'), albumHtml, 'utf8');
      if (albumUrl) sitemapUrls.push({ url: albumUrl, priority: '0.7', videos: album.videos || [] });
      count++;
    }
  }

  // --- releases page ---
  const releasesDir = path.join(outputDir, 'releases');
  await fs.mkdir(releasesDir, { recursive: true });
  const releasesUrl = siteUrl ? `${siteUrl}releases/` : null;
  const releasesHtml = nunjucks.render('releases.njk', {
    ...baseCtx,
    allAlbums: homepageAlbums,
    rootPath: '../',
    canonicalUrl: releasesUrl,
  });
  await fs.writeFile(path.join(releasesDir, 'index.html'), releasesHtml, 'utf8');
  if (releasesUrl) sitemapUrls.push({ url: releasesUrl, priority: '0.6' });
  count++;

  // --- all static pages (imprint, contact, and any extra pages) ---
  for (const page of allNavPages) {
    const html = await loadPage(page.name);
    if (html) {
      const pageDir = path.join(outputDir, page.slug);
      await fs.mkdir(pageDir, { recursive: true });
      const pageUrl = siteUrl ? `${siteUrl}${page.slug}/` : null;
      await fs.writeFile(path.join(pageDir, 'index.html'), nunjucks.render('page.njk', {
        ...baseCtx, title: page.title, pageHtml: html, rootPath: '../',
        canonicalUrl: pageUrl,
      }), 'utf8');
      if (pageUrl) sitemapUrls.push({ url: pageUrl, priority: '0.4' });
      count++;
    }
  }

  // --- 404 page (used by S3/CloudFront as error document) ---
  const notFoundHtml = nunjucks.render('page.njk', {
    ...baseCtx,
    title: 'Page Not Found',
    pageHtml: '<p>The page you are looking for does not exist.</p><p><a href="/">Return to homepage</a></p>',
    rootPath: '/',
    canonicalUrl: null,
  });
  await fs.writeFile(path.join(outputDir, '404.html'), notFoundHtml, 'utf8');
  count++;

  // --- sitemap.xml ---
  if (siteUrl && sitemapUrls.length) {
    const today = new Date().toISOString().slice(0, 10);

    // Helper to extract YouTube video ID
    const ytId = (url) => { const m = (url || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : null }

    const sitemap = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',
      ...sitemapUrls.map(({ url, priority, videos }) => {
        let entry = `  <url>\n    <loc>${url}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>`
        if (videos && videos.length) {
          for (const v of videos) {
            const vid = ytId(v.url)
            if (vid) {
              entry += `\n    <video:video>`
              entry += `\n      <video:thumbnail_loc>https://img.youtube.com/vi/${vid}/hqdefault.jpg</video:thumbnail_loc>`
              entry += `\n      <video:title>${(v.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</video:title>`
              entry += `\n      <video:content_loc>https://www.youtube.com/watch?v=${vid}</video:content_loc>`
              entry += `\n      <video:player_loc>https://www.youtube.com/embed/${vid}</video:player_loc>`
              entry += `\n    </video:video>`
            }
          }
        }
        entry += `\n  </url>`
        return entry
      }),
      '</urlset>',
    ].join('\n');
    await fs.writeFile(path.join(outputDir, 'sitemap.xml'), sitemap, 'utf8');
  }

  // --- robots.txt ---
  const robotsLines = ['User-agent: *', 'Allow: /'];
  if (siteUrl) robotsLines.push(`Sitemap: ${siteUrl}sitemap.xml`);
  await fs.writeFile(path.join(outputDir, 'robots.txt'), robotsLines.join('\n') + '\n', 'utf8');

  return count;
}

module.exports.renderSite = renderSite;
