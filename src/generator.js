'use strict';

const fs = require('fs/promises');
const path = require('path');
const { readCache, writeCache } = require('./cache');
const { scrapeLabel } = require('./scraper');
const { loadContent } = require('./content');
const { mergeData } = require('./merger');
const { assignSlugs, toSlug } = require('./slugs');
const { renderSite } = require('./renderer');
const { copyAssets, downloadFile } = require('./assets');
const { generateRedirects } = require('./redirects');
const { fetchAllArtists } = require('./bandsintown');
const { loadConfig } = require('./configLoader');
const { generateConfig } = require('./configGenerator');

const DEFAULTS = {
  labelUrl: process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || process.env.BANDCAMP_ARTIST_URL || '',
  labelName: process.env.SITE_NAME || process.env.LABEL_NAME || 'My Site',
  outputDir: './dist',
  contentDir: './content',
  cachePath: './cache.json',
  refresh: false,
};

async function generate(options) {
  const startTime = Date.now();
  const opts = { ...DEFAULTS, ...options };
  const { outputDir, contentDir, cachePath, refresh } = opts;

  // Load unified config (config.json > legacy files > null for first run)
  const config = await loadConfig(contentDir);

  // Site identity from config (with env var fallback for backward compat)
  const labelName = (config && config.site && config.site.name) ||
    process.env.SITE_NAME || process.env.LABEL_NAME || 'My Site';

  // Resolve labelUrl from env (config.site.sourceUrl is informational, env is authoritative for secrets/URLs)
  const labelUrl = opts.labelUrl || (config && config.site && config.site.sourceUrl) || '';

  // Validate BANDCAMP_URL format when refresh is requested
  if (refresh) {
    const bandcampUrl = process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || '';
    if (!bandcampUrl) {
      console.error('[error] BANDCAMP_URL is required for --update/--scrape. Set it in your .env file.');
      process.exit(1);
    }
    if (!/^https:\/\/[a-z0-9-]+\.bandcamp\.com\/?$/.test(bandcampUrl)) {
      console.error('[error] BANDCAMP_URL must be a valid Bandcamp URL (https://name.bandcamp.com/)');
      process.exit(1);
    }
  }

  // Environment validation (only when no config and no cache — need URL to scrape)
  if (!labelUrl && !config) {
    console.error('[error] No Bandcamp URL configured. Set BANDCAMP_URL in your .env file.');
    process.exit(1);
  }

  if (!process.env.BANDCAMP_CLIENT_ID || !process.env.BANDCAMP_CLIENT_SECRET) {
    console.warn('[warn] BANDCAMP_CLIENT_ID/SECRET not set - falling back to HTML scraping (slower, less reliable)');
  }
  if (!process.env.SITE_URL) {
    console.warn('[warn] SITE_URL not set - canonical URLs, sitemap, and OG tags will be incomplete');
  }

  // Step 1-3: Resolve raw data from cache or scrape
  let rawData = null;

  if (!refresh) {
    rawData = await readCache(cachePath);
    if (rawData) console.log(`Using cached data from ${cachePath}`);
  }

  // First-run detection: no cache AND no config → trigger scrape + config generation
  if (!rawData && !config) {
    const bandcampUrl = process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || '';
    if (!bandcampUrl) {
      console.error('[error] BANDCAMP_URL is required for first run. Set it in your .env file.');
      process.exit(1);
    }
    const apiCredentials = {
      clientId: process.env.BANDCAMP_CLIENT_ID,
      clientSecret: process.env.BANDCAMP_CLIENT_SECRET
    };
    rawData = await scrapeLabel(bandcampUrl, apiCredentials, contentDir);
    await writeCache(cachePath, rawData);
    await generateConfig(rawData, process.env, contentDir);
    console.log('Generated content/config.json — edit it to configure your site.');
  }

  if (rawData === null) {
    const apiCredentials = {
      clientId: process.env.BANDCAMP_CLIENT_ID,
      clientSecret: process.env.BANDCAMP_CLIENT_SECRET
    };
    try {
      rawData = await scrapeLabel(labelUrl, apiCredentials, contentDir);
    } catch (err) {
      console.error('[generator] Fatal: could not scrape and no cache available.');
      throw err;
    }
    await writeCache(cachePath, rawData);
    console.log(`Cache written to ${cachePath}`);

    // Step 3b: Download remote artwork to local content (only on scrape)
    const { downloadArtwork } = require('./downloadArtwork');
    await downloadArtwork(cachePath, contentDir);
  }

  // Step 4: Load content overrides
  console.log('Loading content overrides...');
  const content = await loadContent(contentDir);

  // Step 4b: Load upcoming releases — announce/preview tier (always runs, no scraping)
  const { loadUpcomingLocal, loadUpcomingFull, applyPresaveUrls } = require('./upcoming');
  const localCount = await loadUpcomingLocal(contentDir, rawData, opts.artistFilter);
  if (localCount > 0) {
    console.log(`Loaded ${localCount} upcoming release(s) (announce/preview).`);
  }

  // Step 4b2: Apply presaveUrls from upcoming.json to existing albums (always runs)
  const presaveCount = await applyPresaveUrls(contentDir, rawData);
  if (presaveCount > 0) {
    console.log(`Applied ${presaveCount} pre-save URL(s) from upcoming.json.`);
  }

  // Step 4c: Load upcoming releases — full tier (only on scrape, requires Bandcamp)
  if (refresh) {
    const fullCount = await loadUpcomingFull(contentDir, rawData, opts.artistFilter);
    if (fullCount > 0) {
      console.log(`Loaded ${fullCount} upcoming release(s) (full).`);
    }
  }

  // Step 5: Merge scraped data with content
  console.log('Merging data...');
  const mergedData = await mergeData(rawData, content);

  // Pass label profile image through for auto-logo in copyAssets
  if (rawData.labelProfileImage) {
    mergedData._labelProfileImage = rawData.labelProfileImage
  }

  // Pass siteMode through for template resolution
  const siteMode = process.env.SITE_MODE || 'label'
  mergedData._siteMode = siteMode

  // Pass theme colors through for CSS variable overrides in copyAssets
  if (rawData.themeColors && Object.keys(rawData.themeColors).length > 0) {
    mergedData.themeColors = rawData.themeColors
  }

  // Step 5a: Auto-download artist photos for artists without local photos
  // Priority: local file > Spotify image > Bandcamp coverImage
  for (const artist of rawData.artists || []) {
    const slug = toSlug(artist.name)
    if (artist.name.toLowerCase() === 'various artists') continue
    const photoPath = path.join(contentDir, slug, 'photo.jpg')
    let hasPhoto = false
    try { await fs.access(photoPath); hasPhoto = true } catch { /* */ }
    if (hasPhoto) continue

    // Try Spotify image first (higher quality)
    const imageUrl = artist._spotifyImageUrl || artist.coverImage
    if (!imageUrl || !imageUrl.startsWith('http')) continue

    await fs.mkdir(path.join(contentDir, slug), { recursive: true })
    const ok = await downloadFile(imageUrl, photoPath)
    if (ok) {
      const source = artist._spotifyImageUrl ? 'Spotify' : 'Bandcamp'
      console.log(`  ✓ Downloaded ${source} artist photo for "${artist.name}"`)
    }
  }

  // Step 5b: Load news articles (Ghost or local)
  const { loadNews } = require('./news');
  let newsArticles = [];
  const ghostUrl = process.env.GHOST_URL;
  const ghostApiKey = process.env.GHOST_CONTENT_API_KEY;

  if (ghostUrl && ghostApiKey) {
    // Ghost is configured — use as exclusive news source
    const { createGhostClient, normalizePost } = require('./ghost');
    const ghost = createGhostClient({ url: ghostUrl, apiKey: ghostApiKey });
    try {
      const rawPosts = await ghost.fetchAllPosts();
      newsArticles = rawPosts.map(normalizePost);
      console.log(`Fetched ${newsArticles.length} Ghost post(s).`);
    } catch (err) {
      console.warn(`[generator] Ghost fetch failed: ${err.message} — falling back to local news`);
      newsArticles = await loadNews(contentDir);
      if (newsArticles.length > 0) {
        console.log(`Loaded ${newsArticles.length} local news article(s) (Ghost fallback).`);
      }
    }
  } else {
    // Ghost not configured — use local news files
    newsArticles = await loadNews(contentDir);
    if (newsArticles.length > 0) {
      console.log(`Loaded ${newsArticles.length} news article(s).`);
    }
  }

  // Step 5c: Create newsletter campaign drafts for new articles
  if (process.env.NEWSLETTER_AUTO_CAMPAIGN === 'true' && newsArticles.length > 0) {
    const { createCampaignDrafts } = require('./newsletterCampaign');
    const campaignCount = await createCampaignDrafts(newsArticles, contentDir);
    if (campaignCount > 0) {
      console.log(`Created ${campaignCount} newsletter campaign draft(s).`);
    }
  }

  // Step 6: Assign slugs
  mergedData.artists = assignSlugs(mergedData.artists);

  // Apply exclusion model from config
  if (config && config.artists) {
    mergedData.artists = mergedData.artists.filter(artist => {
      const slug = artist.slug
      const artistConfig = config.artists[slug]
      if (!artistConfig) return true // not in config = include
      if (artistConfig.exclude === true || artistConfig.enabled === false) return false
      return true
    })

    // Apply album exclusions
    for (const artist of mergedData.artists) {
      const artistConfig = config.artists[artist.slug]
      if (artistConfig && artistConfig.excludeAlbums && artistConfig.excludeAlbums.length > 0) {
        artist.albums = (artist.albums || []).filter(album =>
          !artistConfig.excludeAlbums.includes(album.slug)
        )
      }
    }
  }

  // Step 6b: Fetch Bandsintown data (build-time, not cached)
  console.log('Fetching Bandsintown data...');
  await fetchAllArtists(mergedData, content);

  // Step 7: Render site
  console.log('Rendering pages...');
  let pageCount;
  try {
    pageCount = await renderSite(mergedData, content.pages || {}, outputDir, labelName, newsArticles);
  } catch (err) {
    console.error('[generator] Fatal: could not write to output directory.');
    throw err;
  }

  // Step 8: Copy assets
  console.log('Copying assets...');
  await copyAssets(mergedData, contentDir, outputDir);

  // Step 9: Optimize images (resize + WebP conversion)
  console.log('Optimizing images...');
  const { optimizeImages } = require('./imageOptimizer');
  await optimizeImages(outputDir);

  // Step 10: Generate redirects
  await generateRedirects(contentDir, outputDir);

  // Step 11: Print summary
  const allArtists = (mergedData.artists || []).filter(a => a.name.toLowerCase() !== 'various artists');
  const allAlbums = allArtists.flatMap(a => a.albums || []);

  let withoutPhotos = 0;
  let withoutBios = 0;
  for (const artist of allArtists) {
    const photoPath = path.join(contentDir, artist.slug, 'photo.jpg');
    try { await fs.access(photoPath); } catch { withoutPhotos++; }
    const bioPath = path.join(contentDir, artist.slug, 'bio.md');
    try { await fs.access(bioPath); } catch { withoutBios++; }
  }

  const withoutStreaming = allAlbums.filter(a => !a.streamingLinks || Object.keys(a.streamingLinks).length === 0).length;
  const withoutArtwork = allAlbums.filter(a => !a.artwork).length;

  // Determine logo source
  let hasCustomLogo = false;
  try { await fs.access(path.join(contentDir, 'global', 'logo.png')); hasCustomLogo = true; } catch { /* */ }
  if (!hasCustomLogo) {
    try { await fs.access(path.join('assets', 'logo-round.png')); hasCustomLogo = true; } catch { /* */ }
  }

  const hasNewsletter = !!(process.env.NEWSLETTER_PROVIDER || process.env.NEWSLETTER_ACTION_URL);
  const hasEnrichment = !!(process.env.SOUNDCHARTS_APP_ID || process.env.SPOTIFY_CLIENT_ID);
  const hasDeploy = !!process.env.AWS_S3_BUCKET;

  console.log('\n--- Summary ---');

  // Artists line
  const artistWarnings = [];
  if (withoutPhotos > 0) artistWarnings.push(`${withoutPhotos} without photos`);
  if (withoutBios > 0) artistWarnings.push(`${withoutBios} without bios`);
  console.log(`Artists: ${allArtists.length}${artistWarnings.length ? ' (' + artistWarnings.join(', ') + ')' : ''}`);

  // Albums line
  const albumWarnings = [];
  if (withoutStreaming > 0) albumWarnings.push(`${withoutStreaming} without streaming links`);
  if (withoutArtwork > 0) albumWarnings.push(`${withoutArtwork} without artwork`);
  console.log(`Albums: ${allAlbums.length}${albumWarnings.length ? ' (' + albumWarnings.join(', ') + ')' : ''}`);

  // News line
  if (newsArticles.length > 0) {
    const newsSource = (process.env.GHOST_URL && process.env.GHOST_CONTENT_API_KEY) ? 'from Ghost' : 'local';
    console.log(`News: ${newsArticles.length} article(s) (${newsSource})`);
  }

  // Logo line (only if no custom logo)
  if (!hasCustomLogo && rawData.labelProfileImage) {
    console.log('Logo: Using Bandcamp profile image (no custom logo)');
  } else if (!hasCustomLogo && !rawData.labelProfileImage) {
    console.log('Logo: Not found (add assets/logo-round.png or content/global/logo.png)');
  }

  // Config warnings
  if (!hasNewsletter) console.log('Newsletter: Not configured (set NEWSLETTER_PROVIDER in .env)');
  if (!hasEnrichment) console.log('Enrichment: Not configured (set SOUNDCHARTS_APP_ID or SPOTIFY_CLIENT_ID in .env)');
  if (!hasDeploy) console.log('Deploy: Not configured (set AWS_S3_BUCKET in .env)');

  console.log(`Generated ${pageCount} pages to ${outputDir}`);

  // Suggest next steps
  if (!hasEnrichment) {
    console.log('\nTip: Run with --update to add streaming links (requires Spotify or Soundcharts API credentials).');
    console.log('     Soundcharts is recommended (fewer API calls, more platforms). See wiki for setup.');
  }

  // Report execution time
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${duration}s.`);

  return { outputDir, pageCount };
}

module.exports.generate = generate;
