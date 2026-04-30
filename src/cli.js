'use strict'

/**
 * CLI Router for Label Site Generator v5.0.0
 *
 * Parses CLI arguments and routes to the appropriate pipeline.
 * Replaces the flag parsing in generate.js with a cleaner command router.
 *
 * v5 commands:
 *   node generate.js                    Generate site from cache (offline, fast)
 *   node generate.js --update           Full update: scrape + enrich + generate
 *   node generate.js --news             Fetch news from Ghost CMS + generate
 *   node generate.js --events           Fetch events from Bandsintown + generate
 *   node generate.js --deploy           Generate + deploy to S3
 *   node generate.js --migrate          Convert v4 config to v5 format
 *
 * @module src/cli
 */

const VERSION = '5.0.0'

/**
 * @typedef {object} CLIOptions
 * @property {string} command - 'generate' | 'update' | 'news' | 'events' | 'deploy' | 'migrate'
 * @property {string|null} artistFilter - --artist "Name" value
 * @property {string|null} serviceFilter - 'spotify' | 'discogs' | null (from --spotify, --discogs)
 * @property {boolean} deploy - whether to deploy after generate
 * @property {boolean} force - --force flag
 * @property {string} outputDir - default './dist'
 * @property {string} contentDir - default './content'
 * @property {string} cachePath - default './cache.json'
 */

/**
 * Parse process.argv into a normalized options object.
 *
 * Flag mapping:
 * - No flags → command: 'generate'
 * - --update → command: 'update'
 * - --news → command: 'news'
 * - --events → command: 'events'
 * - --deploy (alone) → command: 'generate', deploy: true
 * - --update --deploy → command: 'update', deploy: true
 * - --migrate → command: 'migrate'
 * - --artist "Name" → artistFilter: "Name"
 * - --spotify → serviceFilter: 'spotify'
 * - --discogs → serviceFilter: 'discogs'
 * - --force → force: true
 *
 * Legacy flag mapping (backward compat):
 * - --scrape → command: 'update'
 * - --enrich → command: 'update'
 * - --scrape --enrich → command: 'update'
 *
 * @param {string[]} argv - process.argv
 * @returns {CLIOptions}
 */
function parseArgs (argv) {
  const args = argv.slice(2)

  const options = {
    command: 'generate',
    artistFilter: null,
    serviceFilter: null,
    deploy: false,
    force: false,
    outputDir: './dist',
    contentDir: './content',
    cachePath: './cache.json'
  }

  // Track raw flags for command resolution
  let hasUpdate = false
  let hasNews = false
  let hasEvents = false
  let hasDeploy = false
  let hasMigrate = false
  let hasScrape = false
  let hasEnrich = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break // eslint-disable-line no-unreachable

      case '--update':
        hasUpdate = true
        break

      case '--news':
        hasNews = true
        break

      case '--events':
        hasEvents = true
        break

      case '--deploy':
        hasDeploy = true
        break

      case '--migrate':
        hasMigrate = true
        break

      case '--artist':
        i++
        options.artistFilter = args[i] || null
        break

      case '--spotify':
        options.serviceFilter = 'spotify'
        break

      case '--discogs':
        options.serviceFilter = 'discogs'
        break

      case '--force':
        options.force = true
        break

      case '--output':
        i++
        if (args[i]) options.outputDir = args[i]
        break

      case '--content':
        i++
        if (args[i]) options.contentDir = args[i]
        break

      case '--cache':
        i++
        if (args[i]) options.cachePath = args[i]
        break

      // Legacy flags (backward compat)
      case '--scrape':
        hasScrape = true
        break

      case '--enrich':
        hasEnrich = true
        break

      default:
        // Unknown flags are silently ignored for forward compatibility
        break
    }
  }

  // Resolve command from flags (priority order)
  if (hasMigrate) {
    options.command = 'migrate'
  } else if (hasUpdate || hasScrape || hasEnrich) {
    options.command = 'update'
  } else if (hasNews) {
    options.command = 'news'
  } else if (hasEvents) {
    options.command = 'events'
  } else {
    options.command = 'generate'
  }

  // Deploy is orthogonal to the command
  options.deploy = hasDeploy

  return options
}

/**
 * Routes parsed options to the appropriate pipeline.
 * Stub implementation — actual pipeline calls will be wired in Task 11.
 *
 * @param {CLIOptions} options
 * @returns {Promise<void>}
 */
async function route (options) {
  switch (options.command) {
    case 'generate':
      // generate from cache (offline, fast)
      break
    case 'update':
      // scrape + enrich + generate
      break
    case 'news':
      // fetch news from Ghost CMS + generate
      break
    case 'events':
      // fetch events from Bandsintown + generate
      break
    case 'migrate':
      // run migrator
      break
  }

  if (options.deploy) {
    // deploy to S3
  }
}

/**
 * Print usage information showing the v5 commands.
 */
function printHelp () {
  console.log(`Label Site Generator v${VERSION}

Usage:
  node generate.js                    Generate site from cache (offline, fast)
  node generate.js --update           Full update: scrape + enrich + generate
  node generate.js --news             Fetch news from Ghost CMS + generate
  node generate.js --events           Fetch events from Bandsintown + generate
  node generate.js --deploy           Generate + deploy to S3
  node generate.js --migrate          Convert v4 config to v5 format

Options:
  --artist "Name"    Limit to one artist
  --spotify          Only update Spotify links
  --discogs          Only update Discogs data
  --force            Force re-processing of already-enriched albums
  --help             Show this help`)
}

module.exports = { parseArgs, route, printHelp }
