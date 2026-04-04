'use strict'

const fs = require('fs/promises')
const path = require('path')
const { readCache } = require('./cache')
const { toSlug } = require('./slugs')

/**
 * Reports orphaned content folders — artist or album folders in content/
 * that don't match any entry in the cache.
 *
 * Does NOT delete anything. Dry-run report only.
 *
 * @param {string} cachePath
 * @param {string} contentDir
 */
async function reportOrphanedContent (cachePath, contentDir) {
  const data = await readCache(cachePath)
  if (!data) {
    console.warn('[cleanup] No cache found.')
    return
  }

  // Build lookup: artist slug → set of album slugs
  const cacheMap = new Map()
  for (const artist of (data.artists || [])) {
    const artistSlug = toSlug(artist.name)
    const albumSlugs = new Set()
    for (const album of (artist.albums || [])) {
      // Add all possible slug forms: explicit slug, title-derived, URL-derived
      if (album.slug) albumSlugs.add(album.slug)
      albumSlugs.add(toSlug(album.title))
      // Extract slug from Bandcamp URL: https://x.bandcamp.com/album/my-slug → my-slug
      if (album.url) {
        const urlMatch = album.url.match(/\/(album|track)\/([^/?#]+)/)
        if (urlMatch) albumSlugs.add(urlMatch[2])
      }
    }
    cacheMap.set(artistSlug, albumSlugs)
  }

  // Known non-artist folders in content/
  const ignoreFolders = new Set(['global', 'pages'])
  // Known non-album files in artist folders
  const ignoreFiles = new Set(['bio.md', 'bio.docx', 'photo.jpg', 'photo.png', 'photo.webp', 'README.txt', 'links.json', 'meta.json'])

  let orphanedArtists = 0
  let orphanedAlbums = 0
  let totalContent = 0

  let entries
  try {
    entries = await fs.readdir(contentDir, { withFileTypes: true })
  } catch {
    console.warn(`[cleanup] Could not read ${contentDir}`)
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (ignoreFolders.has(entry.name)) continue
    if (entry.name === 'extra-artists.txt') continue

    const artistSlug = entry.name
    totalContent++

    if (!cacheMap.has(artistSlug)) {
      console.log(`  ⚠ Orphaned artist folder: content/${artistSlug}/ (no matching artist in cache)`)
      orphanedArtists++
      continue
    }

    const albumSlugs = cacheMap.get(artistSlug)
    const artistDir = path.join(contentDir, artistSlug)

    let subEntries
    try {
      subEntries = await fs.readdir(artistDir, { withFileTypes: true })
    } catch { continue }

    for (const sub of subEntries) {
      if (!sub.isDirectory()) continue
      if (sub.name === 'images') continue // gallery folder, not an album

      if (!albumSlugs.has(sub.name)) {
        // Also check year-deduped slugs (e.g. "principe-valiente-2007")
        // These are created by the merger when two albums share a title
        const yearStripped = sub.name.replace(/-\d{4}$/, '')
        if (albumSlugs.has(yearStripped)) continue
        // Check if the folder has any user content
        let hasContent = false
        try {
          const files = await fs.readdir(path.join(artistDir, sub.name))
          hasContent = files.some(f => !ignoreFiles.has(f) || f === 'reviews.md' || f === 'videos.json' || f === 'stores.json' || f === 'notes.md')
        } catch { /* empty */ }

        const contentNote = hasContent ? ' (contains user content)' : ' (empty or auto-generated only)'
        console.log(`  ⚠ Orphaned album folder: content/${artistSlug}/${sub.name}/${contentNote}`)
        orphanedAlbums++
      }
    }
  }

  console.log(`\n[cleanup] Scanned ${totalContent} artist folder(s).`)
  if (orphanedArtists === 0 && orphanedAlbums === 0) {
    console.log('[cleanup] No orphaned folders found. Content is clean.')
  } else {
    console.log(`[cleanup] Found ${orphanedArtists} orphaned artist folder(s), ${orphanedAlbums} orphaned album folder(s).`)
    console.log('[cleanup] These folders are not referenced by any album in the cache.')
    console.log('[cleanup] Review and delete manually if no longer needed.')
  }
}

/**
 * Performs data quality audit on the cache.
 * Returns a structured report with 6 categories of issues.
 *
 * @param {string} cachePath
 * @returns {Promise<object|null>} audit report or null if no cache
 */
async function auditCache (cachePath) {
  const data = await readCache(cachePath)
  if (!data) {
    console.warn('[audit] No cache found.')
    return null
  }

  const report = {
    emptyTracklists: [],
    missingLabels: [],
    missingStreamingLinks: [],
    missingUpcs: [],
    labelInconsistencies: [],
    duplicateAlbums: []
  }

  // Track all label names for inconsistency detection
  const labelNameMap = new Map() // lowercase → Set of original casings

  for (const artist of (data.artists || [])) {
    const artistName = artist.name
    const albumTitleCount = new Map() // lowercase title → count

    for (const album of (artist.albums || [])) {
      // 1. Albums with Bandcamp URLs but empty tracklists
      if (album.url && (!album.tracks || album.tracks.length === 0)) {
        report.emptyTracklists.push({ artist: artistName, album: album.title, url: album.url })
      }

      // 2. Albums without labelName
      if (!album.labelName) {
        report.missingLabels.push({ artist: artistName, album: album.title })
      }

      // 3. Albums without streamingLinks
      if (!album.streamingLinks || Object.keys(album.streamingLinks).length === 0) {
        report.missingStreamingLinks.push({ artist: artistName, album: album.title })
      }

      // 4. Albums without upc
      if (!album.upc) {
        report.missingUpcs.push({ artist: artistName, album: album.title })
      }

      // Track label names for inconsistency check
      if (album.labelName) {
        const names = album.labelName.split(' / ')
        for (const name of names) {
          const trimmed = name.trim()
          if (!trimmed) continue
          const lower = trimmed.toLowerCase()
          if (!labelNameMap.has(lower)) labelNameMap.set(lower, new Set())
          labelNameMap.get(lower).add(trimmed)
        }
      }

      // Track album titles for duplicate detection
      // Same title + same type + same URL = real dupe
      // Different URLs or different types = legitimate separate releases
      const titleLower = (album.title || '').toLowerCase().trim()
      let typeKey = (album.itemType || '').toLowerCase()
      if (!typeKey && album.url) {
        if (album.url.includes('/track/')) typeKey = 'track'
        else if (album.url.includes('/album/')) typeKey = 'album'
      }
      if (!typeKey) typeKey = 'album'
      const urlKey = album.url || album.upc || ''
      const dupeKey = `${titleLower}::${typeKey}::${urlKey}`
      if (titleLower) {
        // Group by title+type only for counting, but track unique URLs
        const groupKey = `${titleLower}::${typeKey}`
        if (!albumTitleCount.has(groupKey)) albumTitleCount.set(groupKey, new Set())
        albumTitleCount.get(groupKey).add(urlKey)
      }
    }

    // 6. Duplicate albums (same title + same type + same URL under same artist)
    for (const [key, urls] of albumTitleCount) {
      // Only flag if multiple entries share the exact same URL (or both have no URL)
      const urlCounts = {}
      for (const u of urls) {
        urlCounts[u] = (urlCounts[u] || 0) + 1
      }
      for (const [url, count] of Object.entries(urlCounts)) {
        if (count > 1) {
          const title = key.split('::')[0]
          report.duplicateAlbums.push({ artist: artistName, title, count })
        }
      }
    }
  }

  // 5. Label name inconsistencies (case mismatches)
  for (const [lower, variants] of labelNameMap) {
    if (variants.size > 1) {
      report.labelInconsistencies.push({ variants: [...variants], count: variants.size })
    }
  }

  return report
}

/**
 * Prints a structured audit report to the console.
 * @param {object} report - from auditCache()
 */
function printAuditReport (report) {
  if (!report) return

  console.log('\n══════════════════════════════════════════════')
  console.log('  CACHE AUDIT REPORT')
  console.log('══════════════════════════════════════════════')

  // 1. Empty tracklists
  console.log(`\n── Albums with Bandcamp URLs but empty tracklists (${report.emptyTracklists.length}) ──`)
  if (report.emptyTracklists.length === 0) {
    console.log('  ✓ None')
  } else {
    for (const item of report.emptyTracklists) {
      console.log(`  ⚠ ${item.artist} — "${item.album}" (${item.url})`)
    }
  }

  // 2. Missing labels
  console.log(`\n── Albums without labelName (${report.missingLabels.length}) ──`)
  if (report.missingLabels.length === 0) {
    console.log('  ✓ None')
  } else {
    for (const item of report.missingLabels) {
      console.log(`  ⚠ ${item.artist} — "${item.album}"`)
    }
  }

  // 3. Missing streaming links
  console.log(`\n── Albums without streamingLinks (${report.missingStreamingLinks.length}) ──`)
  if (report.missingStreamingLinks.length === 0) {
    console.log('  ✓ None')
  } else {
    for (const item of report.missingStreamingLinks) {
      console.log(`  ⚠ ${item.artist} — "${item.album}"`)
    }
  }

  // 4. Missing UPCs
  console.log(`\n── Albums without UPC (${report.missingUpcs.length}) ──`)
  if (report.missingUpcs.length === 0) {
    console.log('  ✓ None')
  } else {
    for (const item of report.missingUpcs) {
      console.log(`  ⚠ ${item.artist} — "${item.album}"`)
    }
  }

  // 5. Label inconsistencies
  console.log(`\n── Label name inconsistencies (${report.labelInconsistencies.length}) ──`)
  if (report.labelInconsistencies.length === 0) {
    console.log('  ✓ None')
  } else {
    for (const item of report.labelInconsistencies) {
      console.log(`  ⚠ ${item.variants.join(' / ')} (${item.count} variants)`)
    }
  }

  // 6. Duplicate albums
  console.log(`\n── Duplicate albums (${report.duplicateAlbums.length}) ──`)
  if (report.duplicateAlbums.length === 0) {
    console.log('  ✓ None')
  } else {
    for (const item of report.duplicateAlbums) {
      console.log(`  ⚠ ${item.artist} — "${item.title}" (${item.count} copies)`)
    }
  }

  console.log('\n══════════════════════════════════════════════')
  const totalIssues = report.emptyTracklists.length + report.missingLabels.length +
    report.missingStreamingLinks.length + report.missingUpcs.length +
    report.labelInconsistencies.length + report.duplicateAlbums.length
  console.log(`  Total issues: ${totalIssues}`)
  console.log('══════════════════════════════════════════════\n')
}

module.exports = { reportOrphanedContent, auditCache, printAuditReport }
