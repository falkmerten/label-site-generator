'use strict'

const fs = require('fs/promises')
const path = require('path')
const { loadLegacyConfig, writeConfig } = require('./configLoader')
const { validate } = require('./configValidator')
const { CONFIG_SCHEMA } = require('./configSchema')

/**
 * Migrates v4 configuration to v5 format.
 * Reads: artists.json, extra-artists.txt, youtube.json, compilations.json, .env
 * Writes: content/config.json
 *
 * @param {string} contentDir - Path to content directory
 * @param {object} options - { force: boolean }
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function migrate (contentDir = './content', options = {}) {
  const configPath = path.join(contentDir, 'config.json')

  // 1. Check if config.json already exists — exit unless --force
  try {
    await fs.access(configPath)
    if (!options.force) {
      const msg = 'config.json already exists. Use --force to overwrite.'
      console.log(msg)
      return { success: false, message: msg }
    }
  } catch {
    // File does not exist — proceed
  }

  // 2. Load legacy config from v4 files
  const legacyConfig = await loadLegacyConfig(contentDir)

  // 3. If no legacy config found, exit
  if (!legacyConfig) {
    const msg = 'No v4 configuration files found to migrate.'
    console.log(msg)
    return { success: false, message: msg }
  }

  // 4. Enhance with additional env var data
  const config = { ...legacyConfig }

  // Site settings from env vars
  config.site = {
    ...config.site,
    name: process.env.SITE_NAME || process.env.LABEL_NAME || config.site.name || 'My Label',
    url: process.env.SITE_URL || config.site.url || null,
    theme: process.env.SITE_THEME || 'standard',
    template: process.env.SITE_TEMPLATE || null,
    source: 'bandcamp',
    sourceUrl: process.env.BANDCAMP_URL || process.env.BANDCAMP_LABEL_URL || config.site.sourceUrl || '',
    mode: 'label'
  }

  // Newsletter settings from env vars
  config.newsletter = {
    provider: process.env.NEWSLETTER_PROVIDER || (config.newsletter && config.newsletter.provider) || null,
    actionUrl: process.env.NEWSLETTER_ACTION_URL || (config.newsletter && config.newsletter.actionUrl) || null,
    formId: process.env.NEWSLETTER_KEILA_FORM_ID || process.env.NEWSLETTER_FORM_ID || (config.newsletter && config.newsletter.formId) || null,
    listId: process.env.NEWSLETTER_LIST_ID || (config.newsletter && config.newsletter.listId) || null
  }

  // 5. Validate against schema
  const result = validate(config, CONFIG_SCHEMA)
  if (!result.valid) {
    const errorLines = result.errors.map(e => `  ${e.path}: ${e.message}`)
    console.error('Migration produced invalid config:')
    console.error(errorLines.join('\n'))
    return { success: false, message: 'Validation failed', errors: result.errors }
  }

  // 6. Write config
  await writeConfig(config, contentDir)

  // 7. Print summary
  const artistCount = Object.keys(config.artists || {}).length
  const extraCount = Object.values(config.artists || {}).filter(a => a.source === 'extra').length
  const youtubeCount = Object.values(config.artists || {}).filter(a => a.links && a.links.youtube).length
  const compilationCount = (config.compilations || []).length

  console.log(`Migrated ${artistCount} artists, ${extraCount} extra artists, ${youtubeCount} YouTube channels, ${compilationCount} compilations`)
  console.log('You can now remove artists.json, extra-artists.txt, youtube.json, compilations.json')

  return {
    success: true,
    message: 'Migration complete',
    summary: { artists: artistCount, extra: extraCount, youtube: youtubeCount, compilations: compilationCount }
  }
}

module.exports = { migrate }
