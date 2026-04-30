'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')
const http = require('http')
const { resolveTheme } = require('./themeResolver')

/**
 * Downloads a file from a URL and saves it to the given path.
 * Follows redirects (up to 5). Returns true on success, false on failure.
 * @param {string} url - The URL to download
 * @param {string} destPath - Local file path to save to
 * @returns {Promise<boolean>}
 */
function downloadFile (url, destPath, maxRedirects = 5) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (maxRedirects <= 0) return resolve(false)
        const redirectUrl = new URL(res.headers.location, url).toString()
        return resolve(downloadFile(redirectUrl, destPath, maxRedirects - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return resolve(false)
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', async () => {
        try {
          await fs.writeFile(destPath, Buffer.concat(chunks))
          resolve(true)
        } catch {
          resolve(false)
        }
      })
      res.on('error', () => resolve(false))
    }).on('error', () => resolve(false))
  })
}

/**
 * Copies all files from content/global/ (if it exists) to outputDir/,
 * writes theme CSS if none was found, copies local artist photos
 * and album artwork to their respective output directories.
 *
 * @param {object} data - MergedSiteData
 * @param {string} contentDir - path to the content directory
 * @param {string} outputDir - path to the output directory
 */
async function copyAssets (data, contentDir, outputDir) {
  await fs.mkdir(outputDir, { recursive: true })

  // 0. Check for template-bundled style.css (SITE_TEMPLATE takes priority)
  let hasStyleCss = false
  const siteTemplate = process.env.SITE_TEMPLATE || ''
  if (siteTemplate) {
    const templateCssPath = path.join(__dirname, '..', 'templates', siteTemplate, 'style.css')
    try {
      await fs.access(templateCssPath)
      await fs.copyFile(templateCssPath, path.join(outputDir, 'style.css'))
      hasStyleCss = true
    } catch { /* no template CSS, continue to content/global check */ }
  }

  // 1. Copy content/global/ to outputDir/
  const globalDir = path.join(contentDir, 'global')

  try {
    const entries = await fs.readdir(globalDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const src = path.join(globalDir, entry.name)
      const dest = path.join(outputDir, entry.name)
      await fs.copyFile(src, dest)
      if (entry.name === 'style.css') {
        hasStyleCss = true
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // global dir doesn't exist — that's fine
  }

  // 2. Write theme CSS if no custom style.css was found
  if (!hasStyleCss) {
    const themeName = process.env.SITE_THEME || ''
    const envOverrides = {}
    if (process.env.THEME_COLOR_BACKGROUND) envOverrides.background = process.env.THEME_COLOR_BACKGROUND
    if (process.env.THEME_COLOR_TEXT) envOverrides.text = process.env.THEME_COLOR_TEXT
    if (process.env.THEME_COLOR_LINK) envOverrides.link = process.env.THEME_COLOR_LINK
    const themesDir = path.join(__dirname, '..', 'templates', 'themes')
    const { css, warnings } = resolveTheme(themeName, data.themeColors || {}, envOverrides, themesDir)
    warnings.forEach(w => console.warn(w))
    await fs.writeFile(path.join(outputDir, 'style.css'), css, 'utf8')
  }

  // 3. Copy brand assets (logo, banner, placeholder, favicons) from ./assets/
  const brandAssets = ['logo-round.png', 'banner.jpg', 'artwork-placeholder.svg', 'artist-placeholder.svg', 'favicon.ico', 'favicon-96x96.png', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', 'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png']
  for (const file of brandAssets) {
    const src = path.join('assets', file)
    const dest = path.join(outputDir, file)
    try {
      await fs.copyFile(src, dest)
      // Touch the destination so the image optimizer detects it as newer than cached WebP
      const now = new Date()
      await fs.utimes(dest, now, now)
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[assets] Could not copy ${file}:`, err.message)
    }
  }

  // 3b. Generate minimal fallback assets if not provided by the user
  const fallbacks = {
    'artwork-placeholder.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="#dcdce8" width="1" height="1"/></svg>',
    'site.webmanifest': JSON.stringify({ name: process.env.SITE_NAME || process.env.LABEL_NAME || 'My Site', short_name: process.env.SITE_NAME || process.env.LABEL_NAME || 'My Site', display: 'browser', background_color: '#f7f7fa', theme_color: '#0c0032' })
  }
  for (const [file, content] of Object.entries(fallbacks)) {
    const dest = path.join(outputDir, file)
    try { await fs.access(dest) } catch {
      await fs.writeFile(dest, content, 'utf8')
    }
  }

  // 3a. Auto-download Bandcamp profile image as logo if no custom logo exists
  // Labels get auto-logo: explicit label mode OR multiple artists detected (band account acting as label)
  const nonVaArtists = (data.artists || []).filter(a => (a.name || '').toLowerCase() !== 'various artists')
  const isLabel = (data._siteMode || 'label') === 'label' || nonVaArtists.length > 1
  if (data._labelProfileImage && isLabel) {
    const assetsLogoPath = path.join('assets', 'logo-round.png')
    let hasAssetsLogo = false
    try { await fs.access(assetsLogoPath); hasAssetsLogo = true } catch { /* */ }

    if (!hasAssetsLogo) {
      // Download to assets/ so it persists across generates
      await fs.mkdir('assets', { recursive: true })
      const ok = await downloadFile(data._labelProfileImage, assetsLogoPath)
      if (ok) {
        console.log('Downloaded Bandcamp profile image to assets/logo-round.png')
      }
    }

    // Copy to dist/ (whether just downloaded or already existed)
    const logoPath = path.join(outputDir, 'logo-round.png')
    let hasLogo = false
    try { await fs.access(logoPath); hasLogo = true } catch { /* */ }
    if (!hasLogo) {
      try {
        await fs.access(assetsLogoPath)
        await fs.copyFile(assetsLogoPath, logoPath)
      } catch { /* */ }
    }
  }

  // 3b. Copy Font Awesome (self-hosted, no CDN dependency)
  const faBase = path.join('node_modules', '@fortawesome', 'fontawesome-free')
  const faCssDir = path.join(outputDir, 'fa', 'css')
  const faFontDir = path.join(outputDir, 'fa', 'webfonts')
  await fs.mkdir(faCssDir, { recursive: true })
  await fs.mkdir(faFontDir, { recursive: true })
  try {
    await fs.copyFile(path.join(faBase, 'css', 'all.min.css'), path.join(faCssDir, 'all.min.css'))
    const webfonts = await fs.readdir(path.join(faBase, 'webfonts'))
    for (const wf of webfonts) {
      await fs.copyFile(path.join(faBase, 'webfonts', wf), path.join(faFontDir, wf))
    }
  } catch (err) {
    console.warn(`[assets] Could not copy Font Awesome: ${err.message}`)
  }

  // 4. Copy local artist photos and album artwork
  for (const artist of (data.artists || [])) {
    const artistOutDir = path.join(outputDir, 'artists', artist.slug)

    // Artist photo
    if (artist.photo && !artist.photo.startsWith('http')) {
      await fs.mkdir(artistOutDir, { recursive: true })
      const filename = path.basename(artist.photo)
      // Try content/{artist-slug}/{filename} first, then the path as-is
      const contentPath = path.join(contentDir, artist.slug, filename)
      let src = artist.photo
      try { await fs.access(contentPath); src = contentPath } catch {
        try { await fs.access(artist.photo) } catch {
          console.warn(`[assets] Photo not found for "${artist.name}": ${filename}`)
          src = null
        }
      }
      if (src) await fs.copyFile(src, path.join(artistOutDir, filename))
    }

    // Artist photo fallback: download from Spotify if no local photo and enrichment provided one
    if (!artist.photo || artist.photo.startsWith('http')) {
      const spotifyImgUrl = artist._spotifyImageUrl
      if (spotifyImgUrl) {
        const photoPath = path.join(contentDir, artist.slug, 'photo.jpg')
        let hasLocal = false
        try { await fs.access(photoPath); hasLocal = true } catch { /* */ }
        if (!hasLocal) {
          await fs.mkdir(path.join(contentDir, artist.slug), { recursive: true })
          const ok = await downloadFile(spotifyImgUrl, photoPath)
          if (ok) {
            console.log(`  ✓ Downloaded Spotify artist image for "${artist.name}"`)
            // Also copy to output
            await fs.mkdir(artistOutDir, { recursive: true })
            await fs.copyFile(photoPath, path.join(artistOutDir, 'photo.jpg'))
          }
        }
      }
    }

    // Gallery images
    if (artist.galleryImages && artist.galleryImages.length > 0) {
      const galleryOutDir = path.join(artistOutDir, 'images')
      await fs.mkdir(galleryOutDir, { recursive: true })
      for (const imgPath of artist.galleryImages) {
        if (!imgPath.startsWith('http')) {
          const filename = path.basename(imgPath)
          const src = path.join(contentDir, artist.slug, 'images', filename)
          try {
            await fs.copyFile(src, path.join(galleryOutDir, filename))
          } catch (err) {
            console.warn(`[assets] Gallery image not found for "${artist.name}": ${filename}`)
          }
        }
      }
    }

    // Album artwork
    for (const album of (artist.albums || [])) {
      if (album.artwork && !album.artwork.startsWith('http')) {
        const albumOutDir = path.join(artistOutDir, album.slug)
        await fs.mkdir(albumOutDir, { recursive: true })
        const filename = path.basename(album.artwork)
        // Try content/{artist-slug}/{album-slug}/{filename} first,
        // then strip numeric dedup suffix (e.g. center-of-your-world-2 → center-of-your-world),
        // then artwork as-is
        const baseSlug = album.slug.replace(/-\d+$/, '')
        const isDeduped = baseSlug !== album.slug
        const candidates = [
          path.join(contentDir, artist.slug, album.slug, filename)
        ]
        // For collision-suffixed slugs (e.g. principe-valiente-2), try URL-derived
        // and year-deduped candidates BEFORE the base slug to avoid picking up
        // the wrong same-named release's artwork
        if (album.url) {
          const urlMatch = album.url.match(/\/(album|track)\/([^/?#]+)/)
          if (urlMatch && urlMatch[2] !== album.slug && urlMatch[2] !== baseSlug) {
            candidates.push(path.join(contentDir, artist.slug, urlMatch[2], filename))
          }
        }
        if (album.releaseDate) {
          const year = new Date(album.releaseDate).getFullYear()
          const yearSlug = `${baseSlug}-${year}`
          if (yearSlug !== album.slug) {
            candidates.push(path.join(contentDir, artist.slug, yearSlug, filename))
          }
        }
        // Base slug fallback only when slug was deduped (otherwise it's the same as album.slug)
        if (isDeduped) {
          candidates.push(path.join(contentDir, artist.slug, baseSlug, filename))
        }
        candidates.push(album.artwork)
        let src = null
        for (const candidate of candidates) {
          try { await fs.access(candidate); src = candidate; break } catch { /* try next */ }
        }
        if (src) {
          await fs.copyFile(src, path.join(albumOutDir, filename))
        } else {
          console.warn(`[assets] Artwork not found for "${album.title}": ${filename}`)
        }
      }
    }
  }
}

module.exports = { copyAssets, downloadFile }
