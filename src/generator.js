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
  labelUrl: process.env.BANDCAMP_URL || '',
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
  let config = await loadConfig(contentDir);

  // Startup validation: log success when config is valid
  if (config) {
    // Validate extra artists have bandcampUrl
    if (config.artists) {
      for (const [slug, artist] of Object.entries(config.artists)) {
        if (artist.source === 'extra' && !artist.bandcampUrl) {
          console.warn(`[warn] Extra artist "${slug}" is missing bandcampUrl`)
        }
      }
    }
    console.log('Configuration valid')
  }

  // Site identity from config.json (no env fallback — config is source of truth)
  const labelName = (config && config.site && config.site.name) || 'My Site';

  // Resolve labelUrl from env or config source object
  const labelUrl = opts.labelUrl || (config && config.source && config.source.url) || '';

  // Validate BANDCAMP_URL format when refresh is requested
  if (refresh) {
    const bandcampUrl = process.env.BANDCAMP_URL || '';
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

  // Step 1-3: Resolve raw data from cache or scrape
  let rawData = null;

  if (!refresh) {
    rawData = await readCache(cachePath);
    if (rawData) console.log(`Using cached data from ${cachePath}`);
  }

  // Recovery: cache exists but no config.json (aborted first run) → generate config
  if (rawData && !config) {
    console.log('Cache found but no config.json — generating configuration...')

    // Theme prompt
    let chosenTheme = process.env.SITE_THEME || null
    if (!chosenTheme && !opts._nonInteractive) {
      const readline = require('readline')
      console.log('')
      console.log('  Choose a theme:')
      console.log('    1. standard (clean, light)')
      console.log('    2. dark (dark background, light text)')
      console.log('    3. bandcamp (auto-colors from your Bandcamp page)')
      console.log('')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const themeAnswer = await new Promise(resolve => {
        rl.question('  Theme [1]: ', resolve)
      })
      rl.close()
      const themeMap = { '1': 'standard', '2': 'dark', '3': 'bandcamp', '': 'standard' }
      chosenTheme = themeMap[themeAnswer.trim()] || 'standard'
      console.log(`  → Using theme: ${chosenTheme}`)
      console.log('')
    }
    if (!chosenTheme) chosenTheme = 'standard'
    process.env.SITE_THEME = chosenTheme

    await generateConfig(rawData, process.env, contentDir);
    console.log('Generated content/config.json — edit it to configure your site.')
    // Reload config
    const reloadedConfig = await loadConfig(contentDir)
    if (reloadedConfig) config = reloadedConfig
  }

  // First-run detection: no cache AND no config → trigger scrape + config generation
  if (!rawData && !config) {
    const bandcampUrl = process.env.BANDCAMP_URL || '';
    if (!bandcampUrl) {
      console.error('[error] BANDCAMP_URL is required for first run. Set it in your .env file.');
      process.exit(1);
    }
    const apiCredentials = {
      clientId: process.env.BANDCAMP_CLIENT_ID,
      clientSecret: process.env.BANDCAMP_CLIENT_SECRET
    };

    // CSV check prompt (before scrape — give user a chance to add it)
    const importDir = 'private/imports'
    let hasCsv = false
    try {
      const importEntries = await fs.readdir(importDir)
      hasCsv = importEntries.some(f => f.endsWith('_digital.csv'))
    } catch { /* private/imports/ may not exist */ }

    if (!hasCsv && !opts._nonInteractive) {
      const readline = require('readline')
      const bcSlug = (process.env.BANDCAMP_URL || '').replace(/https?:\/\//, '').replace(/\.bandcamp\.com\/?$/, '')
      console.log('')
      console.log('  No Bandcamp Digital Catalog CSV found in private/imports/.')
      console.log('')
      console.log(`  Export here: https://${bcSlug}.bandcamp.com/tools#catalog`)
      console.log('  Place the downloaded file in private/imports/ for reliable UPC/ISRC matching.')
      console.log('')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise(resolve => {
        rl.question('  Continue with public Bandcamp data only? [Y/n]: ', resolve)
      })
      rl.close()
      if (answer.toLowerCase() === 'n') {
        console.log(`\n  Export your catalog: https://${bcSlug}.bandcamp.com/tools#catalog`)
        console.log('  Place the file in private/imports/ and run again.')
        process.exit(0)
      }
      console.log('')
    } else if (hasCsv) {
      console.log('  ✓ Bandcamp Digital Catalog CSV found in private/imports/')
    }

    // Extra artists prompt (first run only)
    let extraArtistUrls = []
    if (!opts._nonInteractive) {
      const readline = require('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const wantsExtra = await new Promise(resolve => {
        rl.question('  Do you have additional Bandcamp pages to include? [y/N]: ', resolve)
      })
      if (wantsExtra.toLowerCase() === 'y') {
        console.log('  Enter Bandcamp URLs (one per line, empty line to finish):')
        let url = ''
        do {
          url = await new Promise(resolve => { rl.question('  > ', resolve) })
          url = url.trim()
          if (url) {
            try {
              const parsed = new URL(url)
              if (parsed.hostname.endsWith('.bandcamp.com') && parsed.protocol === 'https:') {
                extraArtistUrls.push(url)
              } else {
                console.log('    ⚠ Not a valid Bandcamp URL (must be https://*.bandcamp.com)')
              }
            } catch {
              console.log('    ⚠ Not a valid URL')
            }
          }
        } while (url)
        if (extraArtistUrls.length > 0) {
          console.log(`  Adding ${extraArtistUrls.length} additional artist(s).`)
        }
      }
      rl.close()
      console.log('')
    }

    rawData = await scrapeLabel(bandcampUrl, apiCredentials, contentDir, { extraArtistUrls, _nonInteractive: opts._nonInteractive });
    await writeCache(cachePath, rawData);

    // Theme prompt (first run only, skip with --yes or --theme flag)
    let chosenTheme = process.env.SITE_THEME || null
    if (!chosenTheme && !opts._nonInteractive) {
      const readline = require('readline')
      console.log('')
      console.log('  Choose a theme:')
      console.log('    1. standard (clean, light)')
      console.log('    2. dark (dark background, light text)')
      console.log('    3. bandcamp (auto-colors from your Bandcamp page)')
      console.log('')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const themeAnswer = await new Promise(resolve => {
        rl.question('  Theme [1]: ', resolve)
      })
      rl.close()
      const themeMap = { '1': 'standard', '2': 'dark', '3': 'bandcamp', '': 'standard' }
      chosenTheme = themeMap[themeAnswer.trim()] || 'standard'
      console.log(`  → Using theme: ${chosenTheme}`)
      console.log('')
    }
    if (!chosenTheme) chosenTheme = 'standard'
    process.env.SITE_THEME = chosenTheme

    await generateConfig(rawData, process.env, contentDir);
    console.log('Generated content/config.json — edit it to configure your site.');
  }

  if (rawData === null) {
    const apiCredentials = {
      clientId: process.env.BANDCAMP_CLIENT_ID,
      clientSecret: process.env.BANDCAMP_CLIENT_SECRET
    };
    try {
      rawData = await scrapeLabel(labelUrl, apiCredentials, contentDir, { _nonInteractive: opts._nonInteractive });
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

  // Step 3c: Auto-detect Bandcamp Digital Catalog CSV in private/imports/
  const importDir = 'private/imports'
  const catalogCsvFiles = []
  try {
    const importEntries = await fs.readdir(importDir)
    for (const f of importEntries) {
      if (f.endsWith('_digital.csv')) catalogCsvFiles.push(f)
    }
  } catch { /* private/imports/ may not exist */ }

  if (catalogCsvFiles.length > 0) {
    // Use the most recent file (sorted by name = sorted by date prefix)
    const csvFile = catalogCsvFiles.sort().pop()
    const csvPath = path.join(importDir, csvFile)
    try {
      const csvText = await fs.readFile(csvPath, 'utf8')
      const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length > 1) {
        const headers = lines[0].split(',')
        const idIdx = headers.indexOf('id')
        const upcIdx = headers.indexOf('upc')
        const isrcIdx = headers.indexOf('isrc')
        const catIdx = headers.indexOf('catalog_number')
        const typeIdx = headers.indexOf('type')

        if (idIdx >= 0) {
          let filled = 0
          const csvById = new Map()
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',')
            if (cols[typeIdx] === 'album' && cols[idIdx]) {
              csvById.set(cols[idIdx], {
                upc: upcIdx >= 0 ? cols[upcIdx] : null,
                isrc: isrcIdx >= 0 ? cols[isrcIdx] : null,
                catalogNumber: catIdx >= 0 ? cols[catIdx] : null
              })
            }
          }

          // Match by Bandcamp album ID
          for (const artist of rawData.artists || []) {
            for (const album of artist.albums || []) {
              const bcId = album.raw && album.raw.current && String(album.raw.current.id)
              if (!bcId) continue
              const csvEntry = csvById.get(bcId)
              if (csvEntry) {
                if (csvEntry.upc && !album.upc) { album.upc = csvEntry.upc; filled++ }
                if (csvEntry.catalogNumber && !album.catalogNumber) album.catalogNumber = csvEntry.catalogNumber
              }
            }
          }

          if (filled > 0) {
            console.log(`Catalog CSV: Filled ${filled} UPC(s) from ${csvFile}`)
            await writeCache(cachePath, rawData)
          } else {
            console.log(`Catalog CSV: ${csvFile} loaded (no new UPCs to fill)`)
          }
        }
      }
    } catch (err) {
      console.warn(`[warn] Could not parse catalog CSV: ${err.message}`)
    }
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

  // Resolve site mode: config.json > env > auto-detected from scrape > default 'label'
  const siteMode = (config && config.site && config.site.mode) ||
    process.env.SITE_MODE ||
    rawData._siteMode ||
    'label'
  mergedData._siteMode = siteMode

  // Propagate config.json settings to process.env for renderer/assets (they read env)
  if (config && config.site) {
    if (config.site.template && !process.env.SITE_TEMPLATE) {
      process.env.SITE_TEMPLATE = config.site.template
    }
    if (config.site.theme && !process.env.SITE_THEME) {
      process.env.SITE_THEME = config.site.theme
    }
    if (config.site.url && !process.env.SITE_URL) {
      process.env.SITE_URL = config.site.url
    }
    if (config.site.labelFilter && !process.env.HOMEPAGE_LABELS) {
      process.env.HOMEPAGE_LABELS = config.site.labelFilter.join(',')
    }
    if (config.site.labelAliases && !process.env.LABEL_ALIASES) {
      process.env.LABEL_ALIASES = config.site.labelAliases.join(',')
    }
  }
  // Propagate newsletter config to process.env
  if (config && config.newsletter) {
    const nl = config.newsletter
    if (nl.provider && !process.env.NEWSLETTER_PROVIDER) process.env.NEWSLETTER_PROVIDER = nl.provider
    if (nl.actionUrl && !process.env.NEWSLETTER_ACTION_URL) process.env.NEWSLETTER_ACTION_URL = nl.actionUrl
    if (nl.listId && !process.env.NEWSLETTER_LIST_ID) process.env.NEWSLETTER_LIST_ID = nl.listId
    if (nl.formId && !process.env.NEWSLETTER_KEILA_FORM_ID) process.env.NEWSLETTER_KEILA_FORM_ID = nl.formId
    if (nl.doubleOptin !== undefined && !process.env.NEWSLETTER_DOUBLE_OPTIN) process.env.NEWSLETTER_DOUBLE_OPTIN = String(nl.doubleOptin)
    if (nl.autoCampaign !== undefined && !process.env.NEWSLETTER_AUTO_CAMPAIGN) process.env.NEWSLETTER_AUTO_CAMPAIGN = String(nl.autoCampaign)
    if (nl.fromName && !process.env.NEWSLETTER_FROM_NAME) process.env.NEWSLETTER_FROM_NAME = nl.fromName
    if (nl.fromEmail && !process.env.NEWSLETTER_FROM_EMAIL) process.env.NEWSLETTER_FROM_EMAIL = nl.fromEmail
    if (nl.replyTo && !process.env.NEWSLETTER_REPLY_TO) process.env.NEWSLETTER_REPLY_TO = nl.replyTo
    if (nl.brandId && !process.env.NEWSLETTER_BRAND_ID) process.env.NEWSLETTER_BRAND_ID = nl.brandId
  }

  // Pass theme colors through for CSS variable overrides in copyAssets
  if (rawData.themeColors && Object.keys(rawData.themeColors).length > 0) {
    mergedData.themeColors = rawData.themeColors
  }

  // Step 5a: Auto-download artist photos for artists without local photos
  // Only on scrape/update or first run — not during offline generate
  if (refresh || !config) {
    for (const artist of rawData.artists || []) {
      const slug = toSlug(artist.name)
      if (artist.name.toLowerCase() === 'various artists') continue
      const photoPath = path.join(contentDir, slug, 'photo.jpg')
      let hasPhoto = false
      try { await fs.access(photoPath); hasPhoto = true } catch { /* */ }
      if (hasPhoto) continue

      // Priority: Spotify image (higher quality) > Bandcamp coverImage
      const imageUrl = artist._spotifyImageUrl || artist.coverImage
      if (!imageUrl || !imageUrl.startsWith('http')) continue

      await fs.mkdir(path.join(contentDir, slug), { recursive: true })
      const ok = await downloadFile(imageUrl, photoPath)
      if (ok) {
        const source = artist._spotifyImageUrl ? 'Spotify' : 'Bandcamp'
        console.log(`  ✓ Downloaded ${source} artist photo for "${artist.name}"`)
      }
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

    // Check for artists in config.json that are not in the cache (manually added)
    const cachedSlugs = new Set(mergedData.artists.map(a => a.slug))
    const missingFromCache = Object.entries(config.artists)
      .filter(([slug, a]) => a.enabled !== false && a.exclude !== true && !cachedSlugs.has(slug) && slug !== 'various-artists')
    if (missingFromCache.length > 0) {
      console.warn(`[warn] ${missingFromCache.length} artist(s) in config.json not found in cache:`)
      for (const [slug, a] of missingFromCache) {
        const hint = a.bandcampUrl ? '→ run --update to scrape' : '→ add bandcampUrl to config.json'
        console.warn(`  · ${a.name || slug} (${hint})`)
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

  const hasNewsletter = !!(
    (config && config.newsletter && config.newsletter.provider) ||
    process.env.NEWSLETTER_PROVIDER || process.env.NEWSLETTER_ACTION_URL
  );
  const hasEnrichment = !!(process.env.SOUNDCHARTS_APP_ID || process.env.SPOTIFY_CLIENT_ID);
  const hasSoundcharts = !!(process.env.SOUNDCHARTS_APP_ID && process.env.SOUNDCHARTS_API_KEY);
  const hasDeploy = !!process.env.AWS_S3_BUCKET;
  const currentTheme = (config && config.site && config.site.theme) || 'standard'

  console.log('\n--- Summary ---');
  console.log(`  Artists: ${allArtists.length}${withoutPhotos > 0 ? ` (${withoutPhotos} without photos)` : ''}${withoutBios > 0 ? ` (${withoutBios} without bios)` : ''}`);
  console.log(`  Albums: ${allAlbums.length}${withoutStreaming > 0 ? ` (${withoutStreaming} without streaming links)` : ''}`);
  if (newsArticles.length > 0) console.log(`  News: ${newsArticles.length} article(s)`);
  console.log(`  Theme: ${currentTheme}`);
  console.log(`  Generated ${pageCount} pages to ${outputDir}`);

  // Next steps — actionable, no documentation needed
  console.log('\n--- Next steps ---');
  console.log('  1. View your site:        npx serve dist');
  if (withoutStreaming > 0 && !hasEnrichment) {
    console.log('  2. Add streaming links:   node generate.js --enrich  (set SPOTIFY_CLIENT_ID/SECRET in .env)');
  } else if (withoutStreaming > 0) {
    console.log('  2. Add streaming links:   node generate.js --enrich');
  }
  if (withoutBios > 0) {
    console.log(`  3. Add artist bios:       content/{artist-slug}/bio.md`);
  }
  if (withoutPhotos > 0) {
    console.log(`  4. Add artist photos:     content/{artist-slug}/photo.jpg`);
  }
  if (!hasCustomLogo) {
    console.log('  5. Add label logo:        content/global/logo.png');
    console.log('     Add hero banner:       content/global/banner.jpg');
    console.log('     Generate favicons:     https://realfavicongenerator.net (from your logo)');
  }
  console.log('  6. Add news articles:     content/news/2026/MM-DD-slug.md');
  console.log('  7. Add static pages:      content/pages/about.md, content/pages/imprint.md');
  if (hasDeploy) {
    console.log('  8. Deploy:                node generate.js --deploy');
  } else {
    console.log('  8. Deploy:                node generate.js --deploy  (set AWS_S3_BUCKET in .env)');
  }

  // Config hints
  console.log('\n--- Configuration ---');
  console.log('  Edit content/config.json to:');
  console.log('    - Change theme (site.theme: standard, dark, bandcamp)');
  console.log('    - Set your domain (site.url) for SEO, sitemap, and social sharing');
  console.log('    - Enable/disable artists or exclude specific albums');
  console.log('    - Add new artists (set bandcampUrl, then run --scrape)');
  console.log('    - Configure newsletter (newsletter.provider, newsletter.actionUrl)');
  console.log('    - Configure stores (stores: ["bandcamp", "discogs", ...])');
  console.log('  Full reference: see WORKFLOW.md');

  // Enrichment recommendation
  if (!hasSoundcharts) {
    console.log('\n  Tip: For full metadata (UPC, labels, all platforms), configure Soundcharts.');
    console.log('       See API-SETUP.md for setup instructions.');
  }

  // Report execution time
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${duration}s.`);

  return { outputDir, pageCount };
}

module.exports.generate = generate;
