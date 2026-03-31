'use strict'

const fs = require('fs/promises')
const path = require('path')
const { readCache } = require('./cache')
const { toSlug } = require('./slugs')

const README = `# Artist Content Folder

Drop files here:

  photo.jpg       — Main artist photo (shown in artist page header)
  bio.docx        — Artist biography as Word document (auto-converted to bio.md on generate)
  images/         — Additional artist photos for the gallery (01.jpg, 02.jpg, ...)

Album artwork goes in subfolders named after the album slug:
  {album-slug}/artwork.jpg
`

/**
 * Scaffolds content/{artist-slug}/ folders for each artist in the cache.
 * Existing folders and files are never overwritten.
 *
 * @param {string} cachePath
 * @param {string} contentDir
 */
async function initContent (cachePath, contentDir = './content') {
  const data = await readCache(cachePath)
  if (!data) {
    console.error('[init-content] No cache found — run without flags first to build it.')
    return
  }

  let created = 0
  let skipped = 0

  for (const artist of data.artists || []) {
    const slug = toSlug(artist.name)
    const artistDir = path.join(contentDir, slug)
    const imagesDir = path.join(artistDir, 'images')
    const readmePath = path.join(artistDir, 'README.txt')

    // Create artist folder + images subfolder
    await fs.mkdir(imagesDir, { recursive: true })

    // Write README only if it doesn't exist
    try {
      await fs.access(readmePath)
      skipped++
    } catch {
      await fs.writeFile(readmePath, README, 'utf8')
      created++
      console.log(`  ✓ Created content/${slug}/`)
    }
  }

  console.log(`\nContent folders: ${created} created, ${skipped} already existed.`)
  console.log(`Drop bio.docx and photo.jpg into each artist folder, then run node generate.js`)
}

module.exports = { initContent }
