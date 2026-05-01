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

    // Only set bandcampUrl if the artist has their own Bandcamp page
    // (not the label URL which is shared by all regrouped artists)
    const artistUrl = artist.url || artist.bandcampUrl || null
    const labelOrigin = (env.BANDCAMP_URL || '').replace(/\/+$/, '')
    const isOwnPage = artistUrl && labelOrigin && !artistUrl.replace(/\/+$/, '').includes(labelOrigin.replace('https://', ''))
      ? artistUrl : null

    artists[slug] = {
      name,
      enabled: true,
      source: 'bandcamp',
      relationship: 'member_band',
      exclude: false,
      excludeAlbums: [],
      bandcampUrl: isOwnPage,
      links: {
        spotify: null,
        soundcharts: null,
        bandcamp: isOwnPage,
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

  // Determine site name from Bandcamp page title (no env fallback)
  const siteName = rawData.pageTitle || rawData.title || 'My Site'

  // Site URL: null until user configures it in config.json
  const siteUrl = null

  // Determine site mode
  const siteMode = rawData._siteMode || 'label'

  // Determine theme: SITE_THEME env > 'standard'
  const siteTheme = env.SITE_THEME || 'standard'

  // ── Connected accounts: fetch via API if credentials available ──────────────
  // Adds connected accounts (partnerships) as disabled entries in config.json
  const connectedAccounts = []
  if (env.BANDCAMP_CLIENT_ID && env.BANDCAMP_CLIENT_SECRET) {
    try {
      const { getAccessToken, getMyBands } = require('./bandcampApi')
      const token = await getAccessToken(env.BANDCAMP_CLIENT_ID, env.BANDCAMP_CLIENT_SECRET)
      const { bands } = await getMyBands(token)

      // my_bands returns: label entry (with member_bands) + connected accounts (top-level)
      // member_bands are already in our artists list from the scrape
      // Connected accounts are the ones NOT in member_bands
      const memberSlugs = new Set(Object.keys(artists))
      const labelSlug = toSlug(siteName || '')

      for (const band of bands) {
        if (!band.subdomain) continue
        const slug = toSlug(band.name || band.subdomain)
        if (memberSlugs.has(slug) || slug === labelSlug) continue
        // This is a connected account not in the label roster
        if (!artists[slug]) {
          artists[slug] = {
            name: band.name || band.subdomain,
            enabled: false,
            source: 'bandcamp',
            relationship: 'connected_account',
            exclude: false,
            excludeAlbums: [],
            bandcampUrl: `https://${band.subdomain}.bandcamp.com/`,
            links: {
              spotify: null, soundcharts: null, bandcamp: `https://${band.subdomain}.bandcamp.com/`,
              youtube: null, instagram: null, facebook: null, website: null, tiktok: null, twitter: null, bandsintown: null
            }
          }
          connectedAccounts.push(band.name || band.subdomain)
        }
      }
    } catch (err) {
      // Non-fatal — API may not be available
      if (!err.message.includes('OAuth')) {
        console.warn(`[warn] Could not fetch connected accounts: ${err.message}`)
      }
    }
  }

  const config = {
    site: {
      name: siteName,
      url: siteUrl,
      mode: siteMode,
      theme: siteTheme,
      template: env.SITE_TEMPLATE || null,
      source: 'bandcamp',
      sourceUrl: env.BANDCAMP_URL || '',
      discogsUrl: null
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

  // Report connected accounts
  if (connectedAccounts.length > 0) {
    console.log(`\n  Found ${connectedAccounts.length} connected account(s): ${connectedAccounts.join(', ')}`)
    console.log('  These are saved as disabled in config.json. Enable them to include on your website.')
  }

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
