'use strict'

const https = require('https')
const fs = require('fs')
const path = require('path')

/**
 * Fetches the ElasticStage label page and extracts release slugs and URLs.
 * NOTE: ElasticStage is a JavaScript-rendered app. This function attempts
 * to extract release URLs from the HTML but may return empty if the page
 * requires JS rendering. In that case, use stores.json files manually.
 *
 * @param {string} labelUrl - e.g. https://elasticstage.com/aenaos
 * @returns {Promise<Array<{slug: string, url: string}>>}
 */
function fetchElasticStageReleases (labelUrl) {
  return new Promise((resolve) => {
    https.get(labelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LabelSiteGenerator/2.1)' }
    }, (res) => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
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
  // Load cache first
  let cache = null
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch { /* no cache */ }

  console.log(`Fetching ElasticStage releases from ${labelUrl}...`)
  const releases = await fetchElasticStageReleases(labelUrl)

  if (releases.length === 0) {
    console.warn('[elasticstage] No releases found via scraping (page requires JavaScript rendering)')
    console.log('[elasticstage] Checking existing stores.json files instead...')

    // Report existing stores.json files with elasticstage entries
    let found = 0
    if (cache) {
      for (const artist of cache.artists || []) {
        const artistSlug = artist.name.toLowerCase().normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
        for (const album of artist.albums || []) {
          const albumSlug = album.slug || ''
          const storesPath = path.join(contentDir, artistSlug, albumSlug, 'stores.json')
          if (fs.existsSync(storesPath)) {
            try {
              const stores = JSON.parse(fs.readFileSync(storesPath, 'utf8'))
              const es = stores.find(s => s.store === 'elasticstage')
              if (es) {
                console.log(`  ✓ ${artistSlug}/${albumSlug} → ${es.url}`)
                found++
              }
            } catch { /* skip */ }
          }
        }
      }
    }
    console.log(`[elasticstage] ${found} existing ElasticStage link(s) found in stores.json files`)
    console.log('[elasticstage] To add new releases, create stores.json manually in content/{artist}/{album}/')
    return
  }

  console.log(`Found ${releases.length} release(s) on ElasticStage`)

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
