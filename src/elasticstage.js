'use strict'

const https = require('https')
const fs = require('fs')
const path = require('path')

/**
 * Fetches the ElasticStage label page and extracts release slugs and URLs.
 * Returns array of { slug, url, title } objects.
 *
 * @param {string} labelUrl - e.g. https://elasticstage.com/aenaos
 * @returns {Promise<Array<{slug: string, url: string}>>}
 */
function fetchElasticStageReleases (labelUrl) {
  return new Promise((resolve) => {
    https.get(labelUrl, {
      headers: { 'User-Agent': 'LabelSiteGenerator/2.1' }
    }, (res) => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        // Extract release URLs from href attributes
        const matches = raw.match(/href="(https:\/\/elasticstage\.com\/[^"]+\/releases\/[^"]+)"/g) || []
        const releases = [...new Set(matches.map(m => m.replace(/^href="|"$/g, '')))]
          .map(url => ({
            url,
            slug: url.split('/releases/')[1] || ''
          }))
          .filter(r => r.slug)
        resolve(releases)
      })
    }).on('error', () => resolve([]))
  })
}

/**
 * Syncs ElasticStage release links to stores.json files in the content directory.
 * Matches releases to albums by comparing slugs.
 *
 * @param {string} labelUrl - ElasticStage label page URL
 * @param {string} cachePath - path to cache.json
 * @param {string} contentDir - path to content directory
 */
async function syncElasticStage (labelUrl, cachePath, contentDir) {
  console.log(`Fetching ElasticStage releases from ${labelUrl}...`)
  const releases = await fetchElasticStageReleases(labelUrl)

  if (releases.length === 0) {
    console.warn('[elasticstage] No releases found — page may require JavaScript rendering')
    return
  }

  console.log(`Found ${releases.length} release(s) on ElasticStage`)

  // Load cache to match slugs to artists
  let cache = null
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch { /* no cache */ }

  const storeEntry = (url) => JSON.stringify([{
    store: 'elasticstage',
    label: 'Buy on ElasticStage',
    icon: 'fa-solid fa-record-vinyl',
    url
  }], null, 2)

  for (const release of releases) {
    // Try to match release slug to an album in the cache
    let matched = false
    if (cache) {
      for (const artist of cache.artists || []) {
        const artistSlug = artist.name.toLowerCase().normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
        for (const album of artist.albums || []) {
          // Match if release slug starts with album slug
          const albumSlug = album.slug || ''
          if (release.slug.startsWith(albumSlug) || albumSlug === release.slug.replace(/-album$|-ep$|-single$/, '')) {
            const albumDir = path.join(contentDir, artistSlug, albumSlug)
            fs.mkdirSync(albumDir, { recursive: true })
            const storesPath = path.join(albumDir, 'stores.json')
            fs.writeFileSync(storesPath, storeEntry(release.url), 'utf8')
            console.log(`  ✓ ${artistSlug}/${albumSlug} → ${release.url}`)
            matched = true
            break
          }
        }
        if (matched) break
      }
    }
    if (!matched) {
      console.log(`  ? Unmatched: ${release.url}`)
    }
  }

  console.log('ElasticStage sync complete.')
}

module.exports = { syncElasticStage, fetchElasticStageReleases }
