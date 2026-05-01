'use strict'

const fs = require('fs/promises')
const path = require('path')
const { validate } = require('./configValidator')
const { CONFIG_SCHEMA } = require('./configSchema')

/**
 * Deterministic key ordering for config.json output.
 * Ensures consistent diffs in version control.
 */
const KEY_ORDER = ['site', 'artists', 'compilations', 'newsletter']

/**
 * Loads the unified configuration from content/config.json.
 * Falls back to legacy v4 files if config.json does not exist.
 *
 * @param {string} contentDir - Path to content directory
 * @returns {Promise<object|null>} Parsed config or null if no config source exists
 */
async function loadConfig (contentDir = './content') {
  const configPath = path.join(contentDir, 'config.json')

  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw)

    const result = validate(config, CONFIG_SCHEMA)
    if (!result.valid) {
      const errorLines = result.errors.map(e => `  ${e.path}: ${e.message}`)
      const err = new Error(
        `config.json validation failed:\n${errorLines.join('\n')}`
      )
      err.validationErrors = result.errors
      throw err
    }

    return config
  } catch (err) {
    if (err.code === 'ENOENT') {
      // config.json does not exist — try legacy files
      return loadLegacyConfig(contentDir)
    }
    throw err
  }
}

/**
 * Loads configuration from legacy v4 files as fallback.
 * Reads artists.json, extra-artists.txt, youtube.json, compilations.json.
 *
 * @param {string} contentDir - Path to content directory
 * @returns {Promise<object|null>} Config assembled from legacy files, or null
 */
async function loadLegacyConfig (contentDir) {
  const artists = {}
  let compilations = []
  let hasAnyLegacyFile = false

  // --- artists.json ---
  try {
    const raw = await fs.readFile(path.join(contentDir, 'artists.json'), 'utf8')
    const parsed = JSON.parse(raw)
    hasAnyLegacyFile = true

    for (const [slug, entry] of Object.entries(parsed)) {
      artists[slug] = {
        name: slug,
        enabled: true,
        source: 'bandcamp',
        exclude: false,
        excludeAlbums: [],
        bandcampUrl: null,
        links: {
          spotify: entry.spotifyArtistUrl || null,
          soundcharts: null,
          bandcamp: null,
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
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  // --- extra-artists.txt ---
  try {
    const raw = await fs.readFile(path.join(contentDir, 'extra-artists.txt'), 'utf8')
    hasAnyLegacyFile = true

    const lines = raw.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      // Extract slug from bandcamp URL: https://name.bandcamp.com/
      const match = trimmed.match(/^https?:\/\/([a-z0-9-]+)\.bandcamp\.com\/?$/)
      if (match) {
        const slug = match[1]
        if (!artists[slug]) {
          artists[slug] = {
            name: slug,
            enabled: true,
            source: 'extra',
            exclude: false,
            excludeAlbums: [],
            bandcampUrl: trimmed,
            links: {
              spotify: null,
              soundcharts: null,
              bandcamp: trimmed,
              youtube: null,
              instagram: null,
              facebook: null,
              website: null,
              tiktok: null,
              twitter: null,
              bandsintown: null
            }
          }
        } else {
          // Artist already exists from artists.json — mark as extra source and add bandcampUrl
          artists[slug].source = 'extra'
          artists[slug].bandcampUrl = trimmed
          artists[slug].links.bandcamp = trimmed
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  // --- youtube.json ---
  try {
    const raw = await fs.readFile(path.join(contentDir, 'youtube.json'), 'utf8')
    const parsed = JSON.parse(raw)
    hasAnyLegacyFile = true

    // youtube.json has { labelChannel, artists: { slug: url } }
    const artistChannels = parsed.artists || parsed
    for (const [slug, channelUrl] of Object.entries(artistChannels)) {
      if (slug === 'labelChannel') continue
      if (artists[slug] && channelUrl) {
        artists[slug].links.youtube = channelUrl
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  // --- compilations.json ---
  try {
    const raw = await fs.readFile(path.join(contentDir, 'compilations.json'), 'utf8')
    const parsed = JSON.parse(raw)
    hasAnyLegacyFile = true

    if (Array.isArray(parsed)) {
      // Simple array of slugs or Spotify IDs
      compilations = parsed
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Object keyed by slug (like aenaos-records format)
      compilations = Object.keys(parsed)
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  if (!hasAnyLegacyFile) {
    return null
  }

  return {
    site: {
      name: resolveValue(null, 'site.name', 'SITE_NAME', 'LABEL_NAME', 'My Label'),
      url: resolveValue(null, 'site.url', 'SITE_URL', null, null),
      mode: 'label',
      source: 'bandcamp',
      sourceUrl: process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || ''
    },
    artists,
    compilations,
    newsletter: {
      provider: process.env.NEWSLETTER_PROVIDER || null,
      actionUrl: process.env.NEWSLETTER_ACTION_URL || null,
      formId: process.env.NEWSLETTER_FORM_ID || null,
      listId: process.env.NEWSLETTER_LIST_ID || null
    }
  }
}

/**
 * Resolves a single config value with precedence:
 * 1. config.json value (via dot-notation path)
 * 2. .env v5 name
 * 3. .env legacy name — log deprecation warning
 * 4. default value
 *
 * @param {object|null} config - Parsed config object
 * @param {string} configPath - Dot-notation path in config (e.g. "site.name")
 * @param {string} envKey - v5 env var name
 * @param {string|null} legacyEnvKey - Deprecated env var name
 * @param {*} defaultValue - Fallback value
 * @returns {*}
 */
function resolveValue (config, configPath, envKey, legacyEnvKey, defaultValue) {
  // 1. config.json value
  if (config) {
    const value = getNestedValue(config, configPath)
    if (value !== undefined) {
      return value
    }
  }

  // 2. .env v5 name
  if (envKey && process.env[envKey] !== undefined) {
    return process.env[envKey]
  }

  // 3. .env legacy name (with deprecation warning)
  if (legacyEnvKey && process.env[legacyEnvKey] !== undefined) {
    console.warn(
      `[config] Deprecated: using ${legacyEnvKey} from .env. Migrate to config.json (node generate.js --migrate)`
    )
    return process.env[legacyEnvKey]
  }

  // 4. default value
  return defaultValue
}

/**
 * Gets a nested value from an object using dot-notation path.
 *
 * @param {object} obj
 * @param {string} dotPath - e.g. "site.name"
 * @returns {*}
 */
function getNestedValue (obj, dotPath) {
  const parts = dotPath.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = current[part]
  }
  return current
}

/**
 * Writes config object to content/config.json with deterministic key ordering.
 * Uses 2-space indentation for human readability.
 *
 * Only called by configGenerator and enricher write-back.
 *
 * @param {object} config - Config object to write
 * @param {string} contentDir - Path to content directory
 * @returns {Promise<void>}
 */
async function writeConfig (config, contentDir = './content') {
  await fs.mkdir(contentDir, { recursive: true })
  const configPath = path.join(contentDir, 'config.json')
  const ordered = orderKeys(config)
  const json = JSON.stringify(ordered, null, 2)
  await fs.writeFile(configPath, json + '\n', 'utf8')
}

/**
 * Orders config keys deterministically: site, artists, compilations, newsletter.
 * Also orders artist entries' keys for consistent output.
 *
 * @param {object} config
 * @returns {object}
 */
function orderKeys (config) {
  const ordered = {}

  // Add keys in deterministic order
  for (const key of KEY_ORDER) {
    if (key in config) {
      if (key === 'artists') {
        ordered.artists = orderArtists(config.artists)
      } else {
        ordered[key] = config[key]
      }
    }
  }

  // Add any remaining keys not in KEY_ORDER (future-proofing)
  for (const key of Object.keys(config)) {
    if (!KEY_ORDER.includes(key)) {
      ordered[key] = config[key]
    }
  }

  return ordered
}

/**
 * Orders artist entries' internal keys for consistent output.
 *
 * @param {object} artists - Artists object keyed by slug
 * @returns {object}
 */
function orderArtists (artists) {
  const artistKeyOrder = ['name', 'enabled', 'source', 'exclude', 'excludeAlbums', 'bandcampUrl', 'links']
  const ordered = {}

  for (const [slug, artist] of Object.entries(artists)) {
    const orderedArtist = {}
    for (const key of artistKeyOrder) {
      if (key in artist) {
        orderedArtist[key] = artist[key]
      }
    }
    // Add any remaining keys
    for (const key of Object.keys(artist)) {
      if (!artistKeyOrder.includes(key)) {
        orderedArtist[key] = artist[key]
      }
    }
    ordered[slug] = orderedArtist
  }

  return ordered
}

module.exports = { loadConfig, loadLegacyConfig, resolveValue, writeConfig }
