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
const { syncYouTube } = require('./src/youtube');

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
      return options;
    } else if (arg === '--sync-youtube') {
      options.syncYouTube = true;
      return options;
    }
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
  if (options.artistFilter) {
    console.log(`Re-scraping artist: ${options.artistFilter}`);
    await refreshArtist(options.cachePath, options.artistFilter);
    return;
  }
  if (options.enrich) {
    console.log('Enriching cache with streaming links...');
    await enrichCache(options.cachePath, options.contentDir, { tidalOnly: options.tidalOnly });
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
    await syncYouTube(ytKey, options.cachePath, options.contentDir);
    return;
  }
  // Auto-convert any bio.docx files before generating
  await convertAllDocs(options.contentDir);
  const { pageCount, outputDir } = await generate(options);
  console.log(`Generated ${pageCount} pages to ${outputDir}`);

  if (options.deploy) {
    await deploy(outputDir);
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
