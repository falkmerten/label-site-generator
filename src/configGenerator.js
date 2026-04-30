'use strict'

const fs = require('fs/promises')
const path = require('path')
const { writeConfig } = require('./configLoader')
const { toSlug } = require('./slugs')

/**
 * Patterns that identify compilation/various artists entries.
 * Case-insensitive matching.
 */
const COMPILATION_PATTERNS = [
  /^various\s+artists$/i,
  /^various$/i,
  /^v\/a$/i,
  /^va$/i
]

/**
 * Generates content/config.json from scrape results.
 * Only called when no config.json exists (first run or post-scrape without config).
 *
 * @param {object} rawData - Scrape results (RawSiteData with artists array)
 * @param {object} env - Environment variables (process.env)
 * @param {string} contentDir - Path to content directory
 * @returns {Promise<object>} The generated config object
 */
async function generateConfig (rawData, env, contentDir = './content') {
  const configPath = path.join(contentDir, 'config.json')

  // Do NOT overwrite existing config.json
  try {
    await fs.access(configPath)
    // File exists — read and return it without overwriting
    const raw = await fs.readFile(configPath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // File does not exist — proceed with generation
  }

  const artists = {}
  const compilationSlugs = []

  const rawArtists = rawData.artists || []

  for (const artist of rawArtists) {
    const name = artist.name || ''
    const slug = toSlug(name)
    if (!slug) continue

    const bandcampUrl = artist.url || artist.bandcampUrl || null

    artists[slug] = {
      name,
      enabled: true,
      source: 'bandcamp',
      exclude: false,
      excludeAlbums: [],
      bandcampUrl: bandcampUrl,
      links: {
        spotify: null,
        soundcharts: null,
        bandcamp: bandcampUrl,
        youtube: null,
        instagram: null,
        facebook: null,
        website: null,
        tiktok: null,
        twitter: null,
        bandsintown: null
      }
    }
  }

  // Detect compilations
  const detectedCompilations = detectCompilations(rawArtists)
  compilationSlugs.push(...detectedCompilations)

  // Determine site name: SITE_NAME > LABEL_NAME > page title > default
  const siteName = env.SITE_NAME ||
    env.LABEL_NAME ||
    rawData.pageTitle ||
    rawData.title ||
    'My Label'

  // Determine site URL
  const siteUrl = env.SITE_URL || null

  // Determine site mode
  const siteMode = rawData._siteMode || 'label'

  const config = {
    site: {
      name: siteName,
      url: siteUrl,
      mode: siteMode,
      theme: 'standard',
      template: null,
      source: 'bandcamp',
      sourceUrl: env.BANDCAMP_URL || ''
    },
    artists,
    compilations: compilationSlugs,
    newsletter: {
      provider: null,
      actionUrl: null,
      formId: null,
      listId: null
    }
  }

  await writeConfig(config, contentDir)
  return config
}

/**
 * Detects compilation artists from scrape results.
 * Matches: "Various Artists", "Various", "V/A", "VA"
 *
 * @param {Array} artists - Scraped artist list
 * @returns {string[]} Array of compilation artist slugs
 */
function detectCompilations (artists) {
  const compilations = []

  for (const artist of artists) {
    const name = artist.name || ''
    const isCompilation = COMPILATION_PATTERNS.some(pattern => pattern.test(name.trim()))
    if (isCompilation) {
      const slug = toSlug(name)
      if (slug) {
        compilations.push(slug)
      }
    }
  }

  return compilations
}

module.exports = { generateConfig, detectCompilations }
