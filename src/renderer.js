'use strict';

const fs = require('fs/promises');
const path = require('path');
const nunjucks = require('nunjucks');
const { renderMarkdown } = require('./markdown');

// Provider configuration map — add new providers here
const NEWSLETTER_PROVIDERS = {
  sendy: {
    required: ['NEWSLETTER_ACTION_URL', 'NEWSLETTER_LIST_ID'],
    resolve: () => ({
      provider: 'sendy',
      actionUrl: process.env.NEWSLETTER_ACTION_URL || '',
      listId: process.env.NEWSLETTER_LIST_ID || '',
      apiKey: process.env.NEWSLETTER_API_TOKEN || process.env.NEWSLETTER_API_KEY || '',
      doubleOptIn: (process.env.NEWSLETTER_DOUBLE_OPTIN || '').toLowerCase() === 'true'
    })
  },
  listmonk: {
    required: ['NEWSLETTER_ACTION_URL', 'NEWSLETTER_LIST_ID'],
    resolve: () => ({
      provider: 'listmonk',
      actionUrl: process.env.NEWSLETTER_ACTION_URL || '',
      listId: process.env.NEWSLETTER_LIST_ID || '',
      doubleOptIn: (process.env.NEWSLETTER_DOUBLE_OPTIN || '').toLowerCase() === 'true'
    })
  },
  keila: {
    required: ['NEWSLETTER_ACTION_URL', 'NEWSLETTER_KEILA_FORM_ID'],
    resolve: () => ({
      provider: 'keila',
      actionUrl: process.env.NEWSLETTER_ACTION_URL || '',
      formId: process.env.NEWSLETTER_KEILA_FORM_ID || '',
      formUrl: `${process.env.NEWSLETTER_ACTION_URL}/forms/${process.env.NEWSLETTER_KEILA_FORM_ID}`
    })
  }
};

function resolveNewsletter() {
  let provider = (process.env.NEWSLETTER_PROVIDER || '').toLowerCase();

  // Backward compat: no provider set but action URL exists → sendy
  if (!provider && process.env.NEWSLETTER_ACTION_URL) {
    provider = 'sendy';
  }

  if (!provider) {
    return { provider: '', actionUrl: '' };
  }

  const config = NEWSLETTER_PROVIDERS[provider];
  if (!config) {
    console.warn(`[newsletter] Unsupported NEWSLETTER_PROVIDER "${provider}". Skipping newsletter form.`);
    return { provider: '', actionUrl: '' };
  }

  // Check required env vars
  for (const key of config.required) {
    if (!process.env[key]) {
      console.warn(`[newsletter] ${key} is required for provider "${provider}" but not set. Skipping newsletter form.`);
      return { provider: '', actionUrl: '' };
    }
  }

  return config.resolve();
}

/**
 * Render the full static site from merged site data.
 * @param {object} data - MergedSiteData
 * @param {object} pages - map of page name → markdown file path (from content.pages)
 * @param {string} outputDir - Directory to write rendered HTML files into
 * @returns {Promise<number>} Total number of pages written
 */
async function renderSite(data, pages, outputDir, labelName, newsArticles) {
  newsArticles = newsArticles || []
  labelName = labelName || process.env.SITE_NAME || process.env.LABEL_NAME || 'My Site';
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

  // Load extra stores from content/stores.json (search-based store links)
  let extraStores = []
  try {
    const raw = await fs.readFile(path.join(process.env.CONTENT_DIR || './content', 'stores.json'), 'utf8')
    extraStores = JSON.parse(raw)
  } catch { /* no stores.json */ }
  const templatesDir = path.join(__dirname, '..', 'templates');
  const env = nunjucks.configure(templatesDir, { autoescape: true });

  // Custom filter: check if a URL is a local file (not http/https)
  env.addFilter('isLocal', (url) => url && !url.startsWith('http'));

  // Custom filter: convert image path to WebP equivalent
  env.addFilter('toWebp', (url) => url ? url.replace(/\.(jpg|jpeg|png)$/i, '.webp') : url);

  // Custom filter: convert image path to mobile WebP variant
  env.addFilter('toMobileWebp', (url) => url ? url.replace(/\.(jpg|jpeg|png)$/i, '-mobile.webp') : url);

  // Custom filter: URL-encode a string
  env.addFilter('urlencode', (str) => encodeURIComponent(str || ''));

  // Custom filter: resolve store URL template with artist and album name
  env.addFilter('storeUrl', (template, artistName, albumTitle) => {
    return (template || '')
      .replace(/\{artist\}/g, encodeURIComponent(artistName || ''))
      .replace(/\{album\}/g, encodeURIComponent(albumTitle || ''))
  });

  // Custom filter: build search URL for extra stores (content/stores.json)
  env.addFilter('extraStoreSearchUrl', (store, artistName, albumTitle) => {
    if (!store || !store.url) return '#'
    const params = store.params || {}
    const qs = Object.entries(params).map(([k, v]) => {
      const val = (v || '')
        .replace(/\{artist\}/g, artistName || '')
        .replace(/\{album\}/g, albumTitle || '')
      return encodeURIComponent(k) + '=' + encodeURIComponent(val)
    }).join('&')
    return store.url + (qs ? '?' + qs : '')
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

  // Custom filter: check if a date is in the future (for pre-orders / coming soon)
  env.addFilter('isFuture', (iso) => {
    if (!iso) return false
    return new Date(iso) > new Date()
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

  // Collect all upcoming events across all artists, sorted by date
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const allEvents = []
  for (const artist of data.artists || []) {
    const eventUrl = (artist.eventLinks && artist.eventLinks.bandsintown) ||
      (artist.eventLinks && artist.eventLinks.songkick) || null
    for (const event of artist.events || []) {
      // Filter out past events
      const eventDate = new Date(event.date)
      if (eventDate < today) continue
      allEvents.push({ ...event, artistName: artist.name, artistSlug: artist.slug, eventUrl: event.eventUrl || eventUrl })
    }
  }
  allEvents.sort((a, b) => new Date(a.date) - new Date(b.date))

  // Filter albums for homepage/releases page by label if configured
  const labelBandcampOrigin = (() => {
    const url = process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || ''
    try { return new URL(url).origin } catch { return '' }
  })()

  const homepageAlbums = homepageLabels.length > 0
    ? allAlbums.filter(al => {
        // Always include upcoming/pre-order releases
        if (al.upcoming || (al.releaseDate && new Date(al.releaseDate) > new Date())) return true
        // Always include albums from the label's own Bandcamp page (compilations etc.)
        if (labelBandcampOrigin && al.url && al.url.startsWith(labelBandcampOrigin)) return true
        if (!al.labelName) return false // no label = exclude when filter is active
        const labels = al.labelName.toLowerCase().split('/').map(s => s.trim())
        return labels.some(l => homepageLabels.includes(l))
      })
    : allAlbums;

  // Sort artists alphabetically, exclude compilations from artist grid
  // Compute top genre tags per artist (filter out location/nonsense tags, normalize variants)
  const TAG_NORMALIZE = {
    'post punk': 'post-punk', 'dark wave': 'darkwave', 'goth': 'gothic rock',
    'goth rock': 'gothic rock', 'gothic': 'gothic rock', 'synth': 'electronic',
    'synthpop': 'synth-pop', 'electro': 'electronic', 'dark music': 'darkwave',
    'martial': 'industrial', 'indietronica': 'electronic',
    'alternative': 'alternative rock', 'independent': 'independent',
    'dark pop; art pop; electronic': 'dark pop', 'shoegaze folk': 'shoegaze'
  }
  const SKIP_TAGS = new Set([
    'rock', 'pop', 'metal', 'diy',
    'wave',
    'leipzig', 'berlin', 'copenhagen', 'cologne', 'stockholm', 'uppsala',
    'germany', 'sweden', 'denmark', 'vancouver', 'buenos aires', 'salem',
    'diest', 'dgrs'
  ])
  // Dynamically add label name and aliases to skip list
  const siteNameLower = (process.env.SITE_NAME || process.env.LABEL_NAME || '').toLowerCase().trim()
  if (siteNameLower) SKIP_TAGS.add(siteNameLower)
  const labelAliases = (process.env.LABEL_ALIASES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  for (const alias of labelAliases) SKIP_TAGS.add(alias)
  const sortedArtists = [...(data.artists || [])]
    .filter(a => a.name.toLowerCase() !== 'various artists' && a.name.toLowerCase() !== 'various')
    .map(a => {
      const tagCounts = new Map()
      for (const al of a.albums || []) {
        for (const t of al.tags || []) {
          let name = (t.name || t).toLowerCase().trim()
          if (!name || SKIP_TAGS.has(name) || name === a.name.toLowerCase()) continue
          name = TAG_NORMALIZE[name] || name
          tagCounts.set(name, (tagCounts.get(name) || 0) + 1)
        }
      }
      const topTags = [...tagCounts.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([n]) => n)
      return { ...a, topTags }
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

  // Check which brand assets exist (for conditional rendering in templates)
  let hasBanner = false
  let hasLogo = false
  try { await fs.access(path.join(outputDir, 'banner.jpg')); hasBanner = true } catch { /* */ }
  if (!hasBanner) { try { await fs.access(path.join('assets', 'banner.jpg')); hasBanner = true } catch { /* */ } }
  try { await fs.access(path.join(outputDir, 'logo-round.png')); hasLogo = true } catch { /* */ }
  if (!hasLogo) { try { await fs.access(path.join('assets', 'logo-round.png')); hasLogo = true } catch { /* */ } }

  const showOtherLabels = (process.env.OTHER_LABEL_CONTENT || '').toLowerCase() === 'true'

  const baseCtx = {
    artists: sortedArtists,
    hasBanner,
    hasLogo,
    showOtherLabels,
    labelName,
    siteUrl,
    gaMeasurementId,
    physicalStores,
    customStoreDefs,
    extraStores,
    currentYear: new Date().getFullYear(),
    newsletter: resolveNewsletter(),
    latestReleases: homepageAlbums.slice(0, 12),
    totalReleases: homepageAlbums.length,
    labelBandcampUrl: process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || '',
    labelEmail: process.env.SITE_EMAIL || process.env.LABEL_EMAIL || '',
    labelAddress: process.env.SITE_ADDRESS || process.env.LABEL_ADDRESS || '',
    labelVatId: process.env.SITE_VAT_ID || process.env.LABEL_VAT_ID || '',
    siteTagline: process.env.SITE_TAGLINE || '',
    extraPages,
    mainNavPages,
    footerNavPages,
    pages,
    social: {
      bandcamp:   process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || '',
      spotify:    process.env.LABEL_SPOTIFY_URL || '',
      soundcloud: process.env.LABEL_SOUNDCLOUD_URL || '',
      youtube:    process.env.LABEL_YOUTUBE_URL || '',
      instagram:  process.env.LABEL_INSTAGRAM_URL || '',
      facebook:   process.env.LABEL_FACEBOOK_URL || '',
      tiktok:     process.env.LABEL_TIKTOK_URL || '',
      twitter:    process.env.LABEL_TWITTER_URL || '',
    },
    newsArticles: newsArticles.slice(0, 10),
    hasNews: newsArticles.length > 0,
    totalNews: newsArticles.length,
    allEvents: allEvents.slice(0, 10),
    hasEvents: allEvents.length > 0,
  };

  // --- Pre-set news imageUrl so homepage and listing pages can use it ---
  for (const article of newsArticles) {
    if (article.imagePath && !article.imagePath.startsWith('http')) {
      article.imageUrl = path.basename(article.imagePath)
    } else if (article.image) {
      article.imageUrl = article.image
    }
  }

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
    const isCompilationArtist = artist.name.toLowerCase() === 'various artists' || artist.name.toLowerCase() === 'various'

    // Skip artist index page for compilations, but still create album pages
    if (!isCompilationArtist) {
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
          }),
          events: (artist.events || []).filter(e => new Date(e.date) >= today)
        },
        rootPath: '../../',
        canonicalUrl: artistUrl,
      });
      await fs.writeFile(path.join(artistDir, 'index.html'), artistHtml, 'utf8');
      if (artistUrl) sitemapUrls.push({ url: artistUrl, priority: '0.8' });
      count++;
    }

    // Album pages — created for ALL artists including Various Artists
    // Skip announce-tier upcoming albums (no useful content for a standalone page)
    for (const album of artist.albums || []) {
      if (album.tier === 'announce') continue

      const albumDir = path.join(outputDir, 'artists', artist.slug, album.slug);
      await fs.mkdir(albumDir, { recursive: true });
      const albumUrl = siteUrl ? `${siteUrl}artists/${artist.slug}/${album.slug}/` : null;

      const albumHtml = nunjucks.render('album.njk', {
        ...baseCtx,
        album,
        artist,
        isCompilation: isCompilationArtist,
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

  // --- news pages ---
  if (newsArticles.length > 0) {
    const ARTICLES_PER_PAGE = 12

    // Individual article pages
    for (let i = 0; i < newsArticles.length; i++) {
      const article = newsArticles[i]
      const articleDir = path.join(outputDir, 'news', article.slug)
      await fs.mkdir(articleDir, { recursive: true })
      const articleUrl = siteUrl ? `${siteUrl}news/${article.slug}/` : null

      // Copy feature image if local
      if (article.imagePath && !article.imagePath.startsWith('http')) {
        try {
          const imgName = path.basename(article.imagePath)
          await fs.copyFile(article.imagePath, path.join(articleDir, imgName))
          article.imageUrl = imgName
        } catch { /* ignore */ }
      } else if (article.image) {
        article.imageUrl = article.image
      }

      const articleHtml = nunjucks.render('news-article.njk', {
        ...baseCtx,
        article,
        prevArticle: i < newsArticles.length - 1 ? newsArticles[i + 1] : null,
        nextArticle: i > 0 ? newsArticles[i - 1] : null,
        rootPath: '../../',
        canonicalUrl: articleUrl,
      })
      await fs.writeFile(path.join(articleDir, 'index.html'), articleHtml, 'utf8')
      if (articleUrl) sitemapUrls.push({ url: articleUrl, priority: '0.5' })
      count++
    }

    // Paginated listing pages
    const totalPages = Math.ceil(newsArticles.length / ARTICLES_PER_PAGE)
    for (let page = 1; page <= totalPages; page++) {
      const start = (page - 1) * ARTICLES_PER_PAGE
      const pageArticles = newsArticles.slice(start, start + ARTICLES_PER_PAGE)
      const pageDir = page === 1
        ? path.join(outputDir, 'news')
        : path.join(outputDir, 'news', 'page', String(page))
      await fs.mkdir(pageDir, { recursive: true })
      const pageUrl = siteUrl
        ? (page === 1 ? `${siteUrl}news/` : `${siteUrl}news/page/${page}/`)
        : null

      const listHtml = nunjucks.render('news-list.njk', {
        ...baseCtx,
        articles: pageArticles,
        pagination: { current: page, total: totalPages, prev: page > 1 ? page - 1 : null, next: page < totalPages ? page + 1 : null },
        rootPath: page === 1 ? '../' : '../../../',
        canonicalUrl: pageUrl,
      })
      await fs.writeFile(path.join(pageDir, 'index.html'), listHtml, 'utf8')
      if (pageUrl) sitemapUrls.push({ url: pageUrl, priority: '0.6' })
      count++
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

  // --- RSS feed (news articles) ---
  if (siteUrl && newsArticles.length > 0) {
    const escXml = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const rssItems = newsArticles.slice(0, 20).map(a => {
      const articleUrl = `${siteUrl}news/${a.slug}/`
      let imageTag = ''
      if (a.imageUrl) {
        const imgUrl = (a.imageUrl && !a.imageUrl.startsWith('http'))
          ? `${siteUrl}news/${a.slug}/${a.imageUrl}`
          : a.imageUrl
        imageTag = `\n      <enclosure url="${escXml(imgUrl)}" type="image/jpeg" />`
      }
      return `    <item>
      <title>${escXml(a.title)}</title>
      <link>${escXml(articleUrl)}</link>
      <guid>${escXml(articleUrl)}</guid>
      <pubDate>${new Date(a.date).toUTCString()}</pubDate>
      <description>${escXml(a.excerpt)}</description>${imageTag}
    </item>`
    }).join('\n')

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(labelName)} — News</title>
    <link>${escXml(siteUrl)}news/</link>
    <description>Latest news from ${escXml(labelName)}</description>
    <language>en</language>
    <atom:link href="${escXml(siteUrl)}feed.xml" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>`
    await fs.writeFile(path.join(outputDir, 'feed.xml'), rss, 'utf8')
  }

  return count;
}

module.exports.renderSite = renderSite;
module.exports.resolveNewsletter = resolveNewsletter;
