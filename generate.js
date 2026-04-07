#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { generate } = require('./src/generator');
const { enrichCache } = require('./src/enricher');
const { initArtistsConfig } = require('./src/initArtists');
const { initContent } = require('./src/initContent');
const { convertAllDocs } = require('./src/convertDocs');
const { refreshArtist } = require('./src/refreshArtist');
const { downloadArtwork } = require('./src/downloadArtwork');
const { syncElasticStage } = require('./src/elasticstage');
const { syncYouTube, resolveYouTubeHandles } = require('./src/youtube');
const { readCache, writeCache, backupCache } = require('./src/cache');
const { parseCsv, groupByArtist, buildActiveRoster, analyzeGaps, fillGaps, fullImport, printParseSummary } = require('./src/importCsv');

function printUsage() {
  console.log(`Usage: node generate.js [options]

Options:
  --output <dir>   Output directory (default: ./dist)
  --content <dir>  Content directory (default: ./content)
  --cache <file>   Cache file path (default: ./cache.json)
  --refresh        Force re-scrape, ignoring cache
  --artist <name>  Re-scrape a single artist by name or slug (updates cache in place)
  --enrich         Fetch streaming links for cached data, then generate
  --init-artists   Generate content/artists.json with Spotify artist URLs
  --init-content   Scaffold content/{artist}/ folders for bios and images
  --deploy             Sync dist/ to S3 and invalidate CloudFront after generating
  --tidal-only         Re-check Tidal links for all albums (skips Spotify/iTunes/Deezer)
  --download-artwork   Download remote artwork to content/ and update cache
  --sync-elasticstage  Sync ElasticStage release links to stores.json files
  --sync-youtube       Search YouTube and create videos.json for albums without one
  --resolve-youtube    Resolve @handle entries in youtube.json to channel IDs
  --cleanup            Report orphaned content folders not matching any album in cache
  --rollback           Restore the most recent cache backup
  --create-campaigns   Create newsletter campaign drafts for new news articles (without generating site)
  --analyze-csv <path>   Analyze CSV against cache (read-only gap report)
  --fill-gaps <path>     Fill missing metadata in cache from CSV
  --import-csv <path>    Bootstrap cache from CSV (requires --roster-source)
  --roster-source <src>  Active roster source: cache or api (with --import-csv)
  --dry-run              Preview changes without writing (with --fill-gaps or --import-csv)
  --help               Print this help message and exit
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    outputDir: './dist',
    contentDir: './content',
    cachePath: './cache.json',
    refresh: false,
    enrich: false,
    initArtists: false,
    initContent: false,
    artistFilter: null,
    deploy: false,
    analyzeCsv: null,
    fillGaps: null,
    importCsv: null,
    rosterSource: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '--output') {
      options.outputDir = args[++i];
    } else if (arg === '--content') {
      options.contentDir = args[++i];
    } else if (arg === '--cache') {
      options.cachePath = args[++i];
    } else if (arg === '--refresh') {
      options.refresh = true;
    } else if (arg === '--artist') {
      options.artistFilter = args[++i];
    } else if (arg === '--enrich') {
      options.enrich = true;
    } else if (arg === '--init-artists') {
      options.initArtists = true;
    } else if (arg === '--init-content') {
      options.initContent = true;
    } else if (arg === '--deploy') {
      options.deploy = true;
    } else if (arg === '--tidal-only') {
      options.tidalOnly = true;
      options.enrich = true; // implies enrich
    } else if (arg === '--download-artwork') {
      options.downloadArtwork = true;
    } else if (arg === '--sync-elasticstage') {
      options.syncElasticStage = true;
    } else if (arg === '--sync-youtube') {
      options.syncYouTube = true;
    } else if (arg === '--resolve-youtube') {
      options.resolveYouTube = true;
    } else if (arg === '--cleanup') {
      options.cleanup = true;
    } else if (arg === '--rollback') {
      options.rollback = true;
    } else if (arg === '--create-campaigns') {
      options.createCampaigns = true;
    } else if (arg === '--analyze-csv') {
      options.analyzeCsv = args[++i]
    } else if (arg === '--fill-gaps') {
      options.fillGaps = args[++i]
    } else if (arg === '--import-csv') {
      options.importCsv = args[++i]
    } else if (arg === '--roster-source') {
      options.rosterSource = args[++i]
    } else if (arg === '--dry-run') {
      options.dryRun = true
    }
  }

  // Validate CSV flags have a file path
  for (const flag of ['analyzeCsv', 'fillGaps', 'importCsv']) {
    if (options[flag] !== null && (options[flag] === undefined || options[flag].startsWith('--'))) {
      const cliFlag = flag === 'analyzeCsv' ? '--analyze-csv'
        : flag === 'fillGaps' ? '--fill-gaps'
        : '--import-csv'
      console.error(`Usage: ${cliFlag} <path-to-csv>`)
      process.exit(1)
    }
  }

  // Full import requires --roster-source
  if (options.importCsv && !options.rosterSource) {
    console.error('Full import requires --roster-source <cache|api> to filter inactive artists')
    process.exit(1)
  }

  return options;
}

const { execSync } = require('child_process');

async function deploy(outputDir) {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_S3_REGION;
  const distributionId = process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID;

  if (!bucket) {
    console.error('Deploy error: AWS_S3_BUCKET is not set in .env');
    process.exit(1);
  }

  const regionFlag = region ? ` --region ${region}` : '';

  console.log(`Syncing ${outputDir} to s3://${bucket}${region ? ` (${region})` : ''} ...`);

  // Sync with cache headers by file type:
  // 1. Images, fonts, WebP — immutable, 1 year cache
  execSync(
    `aws s3 sync ${outputDir} s3://${bucket} --delete${regionFlag} --exclude "*" --include "*.jpg" --include "*.jpeg" --include "*.png" --include "*.webp" --include "*.svg" --include "*.ico" --include "*.woff2" --include "*.woff" --cache-control "public, max-age=31536000, immutable"`,
    { stdio: 'inherit' }
  );
  // 2. CSS, JS — 1 week cache with revalidation
  execSync(
    `aws s3 sync ${outputDir} s3://${bucket}${regionFlag} --exclude "*" --include "*.css" --include "*.js" --cache-control "public, max-age=604800, must-revalidate"`,
    { stdio: 'inherit' }
  );
  // 3. XML, txt — 1 day cache (sitemap, robots)
  execSync(
    `aws s3 sync ${outputDir} s3://${bucket}${regionFlag} --exclude "*" --include "*.xml" --include "*.txt" --include "*.webmanifest" --cache-control "public, max-age=86400"`,
    { stdio: 'inherit' }
  );
  // 4. HTML — no-cache (always revalidate via CloudFront)
  execSync(
    `aws s3 sync ${outputDir} s3://${bucket}${regionFlag} --exclude "*" --include "*.html" --cache-control "public, max-age=0, must-revalidate"`,
    { stdio: 'inherit' }
  );
  // 5. Everything else (catch-all, no --delete to avoid removing files from previous syncs)
  execSync(
    `aws s3 sync ${outputDir} s3://${bucket} --delete${regionFlag}`,
    { stdio: 'inherit' }
  );
  console.log('S3 sync complete.');

  if (distributionId) {
    console.log(`Creating CloudFront invalidation for distribution ${distributionId} ...`);
    const result = execSync(
      `aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`,
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(result);
    console.log(`CloudFront invalidation created: ${parsed.Invalidation.Id} (${parsed.Invalidation.Status})`);
  } else {
    console.log('AWS_CLOUDFRONT_DISTRIBUTION_ID not set — skipping CloudFront invalidation.');
  }
}

const options = parseArgs(process.argv);

async function run() {
  if (options.rollback) {
    const fsNode = require('fs/promises');
    const pathNode = require('path');
    const dir = pathNode.dirname(options.cachePath) || '.';
    const ext = pathNode.extname(options.cachePath);
    const base = pathNode.basename(options.cachePath, ext);
    const entries = await fsNode.readdir(dir);
    const backups = entries.filter(f => f.startsWith(`${base}.backup.`) && f.endsWith(ext)).sort();
    if (backups.length === 0) {
      console.error('No backup files found.');
      process.exit(1);
    }
    const latest = backups[backups.length - 1];
    const latestPath = pathNode.join(dir, latest);
    await fsNode.copyFile(latestPath, options.cachePath);
    console.log(`Restored ${latest} → ${options.cachePath}`);
    return;
  }
  if (options.createCampaigns) {
    const { loadNews } = require('./src/news');
    const { createCampaignDrafts } = require('./src/newsletterCampaign');
    const articles = await loadNews(options.contentDir);
    if (articles.length === 0) {
      console.log('No news articles found.');
      return;
    }
    const count = await createCampaignDrafts(articles, options.contentDir);
    if (count > 0) {
      console.log(`Created ${count} newsletter campaign draft(s).`);
    } else {
      console.log('No new articles to create campaigns for.');
    }
    return;
  }
  if (options.analyzeCsv) {
    const rows = await parseCsv(options.analyzeCsv)
    const csvArtists = groupByArtist(rows)
    printParseSummary(csvArtists)
    const roster = await buildActiveRoster({ cachePath: options.cachePath, contentDir: options.contentDir })
    const cache = await readCache(options.cachePath)
    const report = analyzeGaps(csvArtists, cache, roster)
    console.log(`\nAnalysis Report:`)
    console.log(`  Matched albums:    ${report.matched.length}`)
    console.log(`  Fillable UPCs:     ${report.fillable.upc}`)
    console.log(`  Fillable catalogs: ${report.fillable.catalogNumber}`)
    console.log(`  Fillable BC IDs:   ${report.fillable.bandcampId}`)
    console.log(`  Fillable dates:    ${report.fillable.releaseDate}`)
    console.log(`  Fillable ISRCs:    ${report.fillable.isrc}`)
    console.log(`  Not in cache:      ${report.notInCache.length}`)
    console.log(`  Not in CSV:        ${report.notInCsv.length}`)
    console.log(`  Inactive artists:  ${report.inactive.length}`)
    return;
  }
  if (options.fillGaps) {
    const rows = await parseCsv(options.fillGaps)
    const csvArtists = groupByArtist(rows)
    printParseSummary(csvArtists)
    const roster = await buildActiveRoster({ cachePath: options.cachePath, contentDir: options.contentDir })
    const cache = await readCache(options.cachePath)
    const report = fillGaps(csvArtists, cache, roster)
    if (!options.dryRun) {
      await backupCache(options.cachePath)
      await writeCache(options.cachePath, cache)
    }
    console.log(`\nFill Gaps Report${options.dryRun ? ' (dry run)' : ''}:`)
    console.log(`  UPCs filled:        ${report.upc}`)
    console.log(`  Catalogs filled:    ${report.catalogNumber}`)
    console.log(`  BC IDs filled:      ${report.bandcampId}`)
    console.log(`  Dates filled:       ${report.releaseDate}`)
    console.log(`  ISRCs filled:       ${report.isrc}`)
    console.log(`  Unmatched CSV:      ${report.unmatchedCsv}`)
    console.log(`  Skipped (inactive): ${report.skippedInactive}`)
    return;
  }
  if (options.importCsv) {
    const rows = await parseCsv(options.importCsv)
    const csvArtists = groupByArtist(rows)
    printParseSummary(csvArtists)
    const roster = await buildActiveRoster({ cachePath: options.cachePath, contentDir: options.contentDir, rosterSource: options.rosterSource })
    const activeCsvArtists = csvArtists.filter(a => roster.has(a.slug))
    const filteredCount = csvArtists.length - activeCsvArtists.length
    if (filteredCount > 0) {
      console.log(`Filtered out ${filteredCount} inactive artist(s)`)
    }
    const newCache = fullImport(activeCsvArtists)
    if (!options.dryRun) {
      await backupCache(options.cachePath)
      await writeCache(options.cachePath, newCache)
    }
    const importedAlbums = activeCsvArtists.reduce((sum, a) => sum + a.albums.length, 0)
    console.log(`\nImport Summary${options.dryRun ? ' (dry run)' : ''}:`)
    console.log(`  Artists imported: ${activeCsvArtists.length}`)
    console.log(`  Albums imported:  ${importedAlbums}`)
    return;
  }
  if (options.initArtists) {
    console.log('Initialising artists config...');
    await initArtistsConfig(options.cachePath, options.contentDir);
    return;
  }
  if (options.initContent) {
    console.log('Scaffolding content folders...');
    await initContent(options.cachePath, options.contentDir);
    return;
  }
  if (options.artistFilter && !options.enrich && !options.syncYouTube && !options.syncElasticStage && !options.cleanup) {
    const backupPath = await backupCache(options.cachePath);
    if (backupPath) console.log(`Cache backed up to ${backupPath}`);
    console.log(`Re-scraping artist: ${options.artistFilter}`);
    await refreshArtist(options.cachePath, options.artistFilter);
    return;
  }
  if (options.enrich) {
    const backupPath = await backupCache(options.cachePath);
    if (backupPath) console.log(`Cache backed up to ${backupPath}`);
    console.log('Enriching cache with streaming links...');
    await enrichCache(options.cachePath, options.contentDir, {
      tidalOnly: options.tidalOnly,
      artistFilter: options.artistFilter || null,
      refresh: options.refresh || false
    });
  }
  if (options.downloadArtwork) {
    console.log('Downloading remote artwork to content/...');
    await downloadArtwork(options.cachePath, options.contentDir);
  }
  if (options.syncElasticStage) {
    const esUrl = process.env.ELASTICSTAGE_LABEL_URL;
    if (!esUrl) {
      console.error('Error: ELASTICSTAGE_LABEL_URL is not set in .env');
      process.exit(1);
    }
    console.log('Syncing ElasticStage releases...');
    await syncElasticStage(esUrl, options.cachePath, options.contentDir);
    return;
  }
  if (options.syncYouTube) {
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      console.error('Error: YOUTUBE_API_KEY is not set in .env');
      process.exit(1);
    }
    console.log('Syncing YouTube videos...');
    await syncYouTube(ytKey, options.cachePath, options.contentDir, { artistFilter: options.artistFilter || null });
    return;
  }
  if (options.resolveYouTube) {
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      console.error('Error: YOUTUBE_API_KEY is not set in .env');
      process.exit(1);
    }
    console.log('Resolving YouTube @handles to channel IDs...');
    await resolveYouTubeHandles(ytKey, options.contentDir);
    return;
  }
  if (options.cleanup) {
    const { reportOrphanedContent, auditCache, printAuditReport } = require('./src/cleanup');
    await reportOrphanedContent(options.cachePath, options.contentDir);
    const report = await auditCache(options.cachePath);
    if (report) printAuditReport(report);
    return;
  }
  // Auto-convert any bio.docx files before generating
  await convertAllDocs(options.contentDir);
  // When --refresh is used with --enrich, don't pass refresh to the generator
  // (refresh in that context means "re-enrich", not "re-scrape from Bandcamp")
  const generateOptions = { ...options }
  if (options.enrich && options.refresh) {
    generateOptions.refresh = false
  }
  const { pageCount, outputDir } = await generate(generateOptions);
  console.log(`Generated ${pageCount} pages to ${outputDir}`);

  if (options.deploy) {
    await deploy(outputDir);
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
