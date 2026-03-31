'use strict'

const https = require('https')
const http = require('http')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { readCache, writeCache } = require('./cache')
const { toSlug } = require('./slugs')

function downloadFile (url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(destPath)
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        fsp.unlink(destPath).catch(() => {})
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        fsp.unlink(destPath).catch(() => {})
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', (err) => {
      file.close()
      fsp.unlink(destPath).catch(() => {})
      reject(err)
    })
  })
}

function extFromUrl (url) {
  const m = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg'
}

/**
 * Downloads remote artwork for all albums that have a remote artwork URL,
 * saves to content/{artist-slug}/{album-slug}/artwork{ext},
 * and updates the cache to use the local path.
 *
 * @param {string} cachePath
 * @param {string} contentDir
 */
async function downloadArtwork (cachePath, contentDir = './content') {
  const data = await readCache(cachePath)
  if (!data) {
    console.warn('[artwork] No cache found.')
    return
  }

  let downloaded = 0
  let skipped = 0

  for (const artist of data.artists || []) {
    const artistSlug = toSlug(artist.name)

    for (const album of artist.albums || []) {
      // Use artwork if set, fall back to imageUrl from scraper
      const remoteUrl = (album.artwork && album.artwork.startsWith('http') ? album.artwork : null)
        || (album.imageUrl && album.imageUrl.startsWith('http') ? album.imageUrl : null)

      if (!remoteUrl) {
        skipped++
        continue
      }

      const albumSlug = album.slug || toSlug(album.title)
      const ext = extFromUrl(remoteUrl)
      const albumContentDir = path.join(contentDir, artistSlug, albumSlug)
      const localFilename = `artwork${ext}`
      const localPath = path.join(albumContentDir, localFilename)

      // Skip if already downloaded
      try {
        await fsp.access(localPath)
        album.artwork = path.relative(process.cwd(), localPath).replace(/\\/g, '/')
        skipped++
        continue
      } catch { /* not yet downloaded */ }

      await fsp.mkdir(albumContentDir, { recursive: true })

      try {
        await downloadFile(remoteUrl, localPath)
        album.artwork = path.relative(process.cwd(), localPath).replace(/\\/g, '/')
        console.log(`  ✓ ${artistSlug}/${albumSlug}/artwork${ext}`)
        downloaded++
      } catch (err) {
        console.warn(`  ⚠ Failed to download artwork for "${album.title}": ${err.message}`)
      }
    }
  }

  await writeCache(cachePath, data)
  console.log(`\nArtwork download complete: ${downloaded} downloaded, ${skipped} skipped.`)
}

module.exports = { downloadArtwork }
