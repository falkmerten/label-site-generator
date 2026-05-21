'use strict'

const https = require('https')
const http = require('http')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { readCache, writeCache } = require('./cache')
const { toSlug, assignSlugs } = require('./slugs')

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
 * Upgrades Bandcamp image URLs from low-res (_2) to hi-res (_10 = 1200x1200).
 */
function upgradeToHiRes (url) {
  if (!url) return url
  return url.replace(/(_)\d{1,3}(\.(jpg|jpeg|png|webp|gif))/i, '$110$2')
}

/**
 * Downloads remote artwork for all albums that have a remote artwork URL,
 * saves to content/{artist-slug}/{album-slug}/artwork{ext},
 * and updates the cache to use the local path.
 *
 * @param {string} cachePath
 * @param {string} contentDir
 * @param {object} [options]
 * @param {boolean} [options.force] - Re-download even if local file exists
 * @param {boolean} [options.upgradeResolution] - Upgrade _2 URLs to _10 (hi-res)
 */
async function downloadArtwork (cachePath, contentDir = './content', options = {}) {
  const { force = false, upgradeResolution = false } = options
  const data = await readCache(cachePath)
  if (!data) {
    console.warn('[artwork] No cache found.')
    return
  }

  // Ensure slugs are disambiguated before downloading (prevents collisions like album/track same name)
  data.artists = assignSlugs(data.artists)

  let downloaded = 0
  let skipped = 0
  let upgraded = 0

  for (const artist of data.artists || []) {
    const artistSlug = toSlug(artist.name)

    // Download artist photo if remote and no local photo exists
    const remotePhoto = (artist.coverImage && artist.coverImage.startsWith('http')) ? artist.coverImage : null
    if (remotePhoto) {
      const photoExt = extFromUrl(remotePhoto)
      const photoDir = path.join(contentDir, artistSlug)
      const photoPath = path.join(photoDir, `photo${photoExt}`)
      try {
        await fsp.access(photoPath)
        skipped++
      } catch {
        await fsp.mkdir(photoDir, { recursive: true })
        try {
          await downloadFile(remotePhoto, photoPath)
          console.log(`  ✓ ${artistSlug}/photo${photoExt}`)
          downloaded++
        } catch (err) {
          console.warn(`  ⚠ Failed to download photo for "${artist.name}": ${err.message}`)
        }
      }
    }

    for (const album of artist.albums || []) {
      // Use artwork if set, fall back to imageUrl from scraper
      let remoteUrl = (album.artwork && album.artwork.startsWith('http') ? album.artwork : null)
        || (album.imageUrl && album.imageUrl.startsWith('http') ? album.imageUrl : null)

      if (!remoteUrl) {
        skipped++
        continue
      }

      // Upgrade to hi-res if requested
      if (upgradeResolution) {
        const hiResUrl = upgradeToHiRes(remoteUrl)
        if (hiResUrl !== remoteUrl) {
          remoteUrl = hiResUrl
          // Also update the cache entry
          if (album.imageUrl && album.imageUrl.startsWith('http')) {
            album.imageUrl = hiResUrl
          }
          upgraded++
        }
      }

      const albumSlug = album.slug || toSlug(album.title)
      const ext = extFromUrl(remoteUrl)
      const albumContentDir = path.join(contentDir, artistSlug, albumSlug)
      const localFilename = `artwork${ext}`
      const localPath = path.join(albumContentDir, localFilename)

      // Skip if already downloaded (unless force mode)
      if (!force) {
        try {
          await fsp.access(localPath)
          album.artwork = localFilename
          skipped++
          continue
        } catch { /* not yet downloaded */ }
      }

      await fsp.mkdir(albumContentDir, { recursive: true })

      try {
        await downloadFile(remoteUrl, localPath)
        album.artwork = localFilename
        console.log(`  ✓ ${artistSlug}/${albumSlug}/artwork${ext}`)
        downloaded++
      } catch (err) {
        console.warn(`  ⚠ Failed to download artwork for "${album.title}": ${err.message}`)
      }
    }
  }

  await writeCache(cachePath, data)
  console.log(`\nArtwork download complete: ${downloaded} downloaded, ${skipped} skipped${upgraded ? `, ${upgraded} URLs upgraded to hi-res` : ''}.`)
}

module.exports = { downloadArtwork }
