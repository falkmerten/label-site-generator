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

module.exports = { reportOrphanedContent }
