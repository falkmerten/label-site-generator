'use strict';

const { readCache, writeCache } = require('./cache');
const { scrapeLabel } = require('./scraper');
const { loadContent } = require('./content');
const { mergeData } = require('./merger');
const { assignSlugs } = require('./slugs');
const { renderSite } = require('./renderer');
const { copyAssets } = require('./assets');
const { generateRedirects } = require('./redirects');

const DEFAULTS = {
  labelUrl: process.env.BANDCAMP_LABEL_URL || 'https://your-label.bandcamp.com/',
  labelName: process.env.LABEL_NAME || 'My Label',
  outputDir: './dist',
  contentDir: './content',
  cachePath: './cache.json',
  refresh: false,
};

async function generate(options) {
  const opts = { ...DEFAULTS, ...options };
  const { labelUrl, labelName, outputDir, contentDir, cachePath, refresh } = opts;

  // Step 1-3: Resolve raw data from cache or scrape
  let rawData = null;

  if (!refresh) {
    rawData = await readCache(cachePath);
    if (rawData) console.log(`Using cached data from ${cachePath}`);
  }

  if (rawData === null) {
    const apiCredentials = {
      clientId: process.env.BANDCAMP_CLIENT_ID,
      clientSecret: process.env.BANDCAMP_CLIENT_SECRET
    };
    try {
      rawData = await scrapeLabel(labelUrl, apiCredentials, opts.contentDir);
    } catch (err) {
      console.error('[generator] Fatal: could not scrape and no cache available.');
      throw err;
    }
    await writeCache(cachePath, rawData);
    console.log(`Cache written to ${cachePath}`);
  }

  // Step 4: Load content overrides
  console.log('Loading content overrides...');
  const content = await loadContent(contentDir);

  // Step 4b: Load upcoming releases from private Bandcamp links
  const { loadUpcoming } = require('./upcoming');
  const upcomingCount = await loadUpcoming(contentDir, rawData);
  if (upcomingCount > 0) {
    console.log(`Loaded ${upcomingCount} upcoming release(s).`);
  }

  // Step 5: Merge scraped data with content
  console.log('Merging data...');
  const mergedData = await mergeData(rawData, content);

  // Step 5b: Load news articles
  const { loadNews } = require('./news');
  const newsArticles = await loadNews(contentDir);
  if (newsArticles.length > 0) {
    console.log(`Loaded ${newsArticles.length} news article(s).`);
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

  return { outputDir, pageCount };
}

module.exports.generate = generate;
