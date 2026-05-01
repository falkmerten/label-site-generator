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
  const compilations = {}
  for (const slug of detectedCompilations) {
    compilations[slug] = {}
  }

  // Backfill links from cache data (streamingLinks, socialLinks, bandLinks)
  for (const artist of rawArtists) {
    const slug = toSlug(artist.name || '')
    if (!slug || !artists[slug]) continue
    const cl = artists[slug].links

    // Streaming links (Spotify artist URL)
    const sl = artist.streamingLinks || {}
    if (sl.spotify && !cl.spotify) cl.spotify = sl.spotify

    // Social links (from Soundcharts enrichment)
    const social = artist.socialLinks || {}
    if (social.youtube && !cl.youtube) cl.youtube = social.youtube
    if (social.instagram && !cl.instagram) cl.instagram = social.instagram
    if (social.facebook && !cl.facebook) cl.facebook = social.facebook
    if (social.tiktok && !cl.tiktok) cl.tiktok = social.tiktok
    if (social.twitter && !cl.twitter) cl.twitter = social.twitter
    if (social.website && !cl.website) cl.website = social.website

    // Discovery links
    const discovery = artist.discoveryLinks || {}
    if (discovery.youtube && !cl.youtube) cl.youtube = discovery.youtube
    if (discovery.website && !cl.website) cl.website = discovery.website

    // Band links (from Bandcamp page)
    for (const link of artist.bandLinks || []) {
      if (!link.url) continue
      if (link.url.includes('youtube.com') && !cl.youtube) cl.youtube = link.url
      if (link.url.includes('instagram.com') && !cl.instagram) cl.instagram = link.url
      if (link.url.includes('facebook.com') && !cl.facebook) cl.facebook = link.url
      if (link.url.includes('tiktok.com') && !cl.tiktok) cl.tiktok = link.url
      if ((link.url.includes('twitter.com') || link.url.includes('x.com')) && !cl.twitter) cl.twitter = link.url
    }
  }

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
  // UNLESS they were already scraped (user added them via prompt = explicit intent)
  const connectedAccounts = []

  if (env.BANDCAMP_CLIENT_ID && env.BANDCAMP_CLIENT_SECRET) {
    try {
      const { getAccessToken, getMyBands } = require('./bandcampApi')
      const token = await getAccessToken(env.BANDCAMP_CLIENT_ID, env.BANDCAMP_CLIENT_SECRET)
      const { bands } = await getMyBands(token)

      const memberSlugs = new Set(Object.keys(artists))
      const labelSlug = toSlug(siteName || '')

      for (const band of bands) {
        if (!band.subdomain) continue
        const slug = toSlug(band.name || band.subdomain)
        if (memberSlugs.has(slug) || slug === labelSlug) continue
        if (!artists[slug]) {
          // Connected account not already scraped → disabled by default
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
          connectedAccounts.push({ name: band.name || band.subdomain, enabled: false })
        }
      }
    } catch (err) {
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
      template: env.SITE_TEMPLATE || null
    },
    source: {
      primary: 'bandcamp',
      url: env.BANDCAMP_URL || '',
      accountType: rawData._siteMode === 'label' ? 'label' : 'artist',
      detection: (env.BANDCAMP_CLIENT_ID ? 'api_member_bands' : (rawData._siteMode === 'label' ? 'html_artists_page' : 'html_single_artist')),
      confidence: env.BANDCAMP_CLIENT_ID ? 'high' : 'medium'
    },
    artists,
    compilations: compilations,
    stores: ['bandcamp'],
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
    const names = connectedAccounts.map(a => a.name).join(', ')
    console.log(`\n  Connected accounts (disabled): ${names}`)
    console.log('  Enable them in config.json to include on your website.')
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
