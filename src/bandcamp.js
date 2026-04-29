'use strict'

const https = require('https')
const http = require('http')
const cheerio = require('cheerio')
const urlHelper = require('url')

/**
 * Fetches a URL over HTTPS, following up to maxRedirects redirects.
 * Returns the response body as a string.
 */
function fetchPage (pageUrl, maxRedirects = 5, _retryCount = 0) {
  return new Promise((resolve, reject) => {
    const protocol = pageUrl.startsWith('https') ? https : http
    protocol.get(pageUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'))
        const redirectUrl = new URL(res.headers.location, pageUrl).toString()
        res.resume()
        return resolve(fetchPage(redirectUrl, maxRedirects - 1, _retryCount))
      }
      if (res.statusCode === 429) {
        res.resume()
        if (_retryCount >= 3) return reject(new Error(`HTTP 429 for ${pageUrl} after ${_retryCount} retries`))
        const backoff = Math.min(5000 * Math.pow(2, _retryCount), 30000)
        console.warn(`[bandcamp] 429 rate limited — waiting ${backoff / 1000}s (attempt ${_retryCount + 1}/3)`)
        return setTimeout(() => {
          resolve(fetchPage(pageUrl, maxRedirects, _retryCount + 1))
        }, backoff)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${pageUrl}`))
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    }).on('error', reject)
  })
}

/**
 * Fetches artist URLs from a label's /artists page.
 * @param {string} labelUrl - The label's Bandcamp URL
 * @returns {Promise<string[]>} Array of artist URLs
 */
async function getArtistUrls (labelUrl) {
  const url = new urlHelper.URL('/artists', labelUrl).toString()
  const html = await fetchPage(url)
  const $ = cheerio.load(html)
  const artistUrls = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (href && /tab=artists*$/.test(href)) {
      const full = new urlHelper.URL(href, url).toString()
      if (artistUrls.indexOf(full) === -1) {
        artistUrls.push(full)
      }
    }
  })
  return artistUrls
}

/**
 * Fetches artist info from an artist's Bandcamp page.
 * @param {string} artistUrl - The artist's Bandcamp URL
 * @returns {Promise<object>} Artist info object
 */
async function getArtistInfo (artistUrl) {
  const html = await fetchPage(artistUrl)
  const $ = cheerio.load(html)

  const name = $('#band-name-location .title').text().trim()
  const location = $('#band-name-location .location').text().trim()
  const coverImage = $('.bio-pic a').attr('href') || null
  const profileImage = $('img.band-photo').attr('src') || null
  const description = $('p#bio-text').text().trim()

  // Albums from music grid
  const albums = []
  $('.music-grid-item').each((_, el) => {
    const a = $(el).find('a')
    const href = a.attr('href') || ''
    const img = $(el).find('img')
    albums.push({
      url: artistUrl + href,
      title: $(el).find('.title').text().trim(),
      coverImage: img.attr('data-original') || img.attr('src') || null
    })
  })

  // Discography albums
  const discographyAlbums = []
  $('#discography ul li').each((_, el) => {
    const a = $(el).find('a')
    const href = a.attr('href') || ''
    discographyAlbums.push({
      url: artistUrl + href,
      title: $(el).find('.trackTitle a').text().trim(),
      coverImage: $(el).find('img').attr('src') || null
    })
  })

  // Merge albums (unique by reference, matching old behavior)
  const mergedAlbums = [...new Set([...albums, ...discographyAlbums])]

  // Shows
  const shows = []
  $('#showography ul li').each((_, el) => {
    shows.push({
      date: $(el).find('.showDate').text().trim(),
      venue: $(el).find('.showVenue a').text().trim(),
      venueUrl: $(el).find('.showVenue a').attr('href') || null,
      location: $(el).find('.showLoc').text().trim()
    })
  })

  // Band links
  const bandLinks = []
  $('#band-links li').each((_, el) => {
    const a = $(el).find('a')
    bandLinks.push({
      name: a.text().trim(),
      url: a.attr('href') || null
    })
  })

  return {
    name,
    location,
    description,
    coverImage,
    profileImage,
    albums: mergedAlbums,
    shows,
    bandLinks
  }
}

/**
 * Fetches album/track URLs from an artist's /music page.
 * @param {string} artistUrl - The artist's Bandcamp URL
 * @returns {Promise<string[]>} Array of album/track URLs
 */
async function getAlbumUrls (artistUrl) {
  const url = new urlHelper.URL('/music', artistUrl).toString()
  const html = await fetchPage(url)
  const $ = cheerio.load(html)
  const albumUrls = []

  // Method 1: Parse the #pagedata data-blob JSON (label accounts)
  const pageData = $('#pagedata')
  if (pageData.length > 0) {
    const blobRaw = pageData.attr('data-blob')
    if (blobRaw) {
      try {
        const blob = JSON.parse(blobRaw)
        if (blob.hub && blob.hub.tabs) {
          for (const tab of blob.hub.tabs) {
            for (const col of (tab.collections || [])) {
              for (const item of (col.items || [])) {
                if (item.page_url) {
                  const full = new urlHelper.URL(item.page_url, artistUrl).toString()
                  if (albumUrls.indexOf(full) === -1) albumUrls.push(full)
                }
              }
            }
          }
        }
      } catch { /* fall through */ }
    }
  }

  // Method 2: Parse ol#music-grid data-client-items (lazy-loaded albums on band accounts)
  // Bandcamp stores non-visible albums as escaped JSON in this attribute
  if (albumUrls.length === 0) {
    const musicGrid = $('ol#music-grid')
    if (musicGrid.length > 0) {
      // First: get albums from visible <li> elements
      musicGrid.find('li[data-item-id] a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (href && /^\/(track|album)\//.test(href)) {
          const full = new urlHelper.URL(href, artistUrl).toString()
          if (albumUrls.indexOf(full) === -1) albumUrls.push(full)
        }
      })

      // Second: get lazy-loaded albums from data-client-items attribute
      const clientItems = musicGrid.attr('data-client-items')
      if (clientItems) {
        try {
          const items = JSON.parse(clientItems)
          for (const item of items) {
            if (item.page_url) {
              const full = new urlHelper.URL(item.page_url, artistUrl).toString()
              if (albumUrls.indexOf(full) === -1) albumUrls.push(full)
            }
          }
        } catch { /* fall through */ }
      }
    }
  }

  // Method 3: Fallback to generic <a> tag parsing
  if (albumUrls.length === 0) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (href && /^\/(track|album)\/(.+)$/.test(href)) {
        const full = new urlHelper.URL(href, artistUrl).toString()
        if (albumUrls.indexOf(full) === -1) albumUrls.push(full)
      }
    })
  }

  return albumUrls
}

/**
 * Extracts a JavaScript object variable from HTML source.
 * @param {string} html - The HTML source
 * @param {string} variableName - The variable name to extract
 * @returns {string|undefined} The raw object string
 */
function extractJavascriptObjectVariable (html, variableName) {
  const regex = new RegExp('var ' + variableName + '\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;')
  const matches = html.match(regex)
  if (matches && matches.length === 2) {
    return matches[1]
  }
}

/**
 * Fetches album info from an album's Bandcamp page.
 * @param {string} albumUrl - The album's Bandcamp URL
 * @returns {Promise<object>} Album info object
 */
async function getAlbumInfo (albumUrl) {
  const html = await fetchPage(albumUrl)
  const $ = cheerio.load(html)

  const artist = $('#name-section span').first().text().trim()
  const title = $('#name-section .trackTitle').first().text().trim()

  let imageUrl = $('#tralbumArt img').attr('src') || null
  if (imageUrl) {
    imageUrl = imageUrl.replace(/_\d{1,3}\./, '_2.') // use small version
  }

  // Tags
  const tags = []
  $('.tag').each((_, el) => {
    const name = $(el).text().trim()
    if (name) tags.push({ name })
  })

  // Tracks (playable)
  const tracks = []
  $('table#track_table tr.track_row_view').each((_, el) => {
    const trackName = $(el).find('span.track-title').text().trim()
    const linkHref = $(el).find('.info_link a').attr('href') || null
    const trackUrl = linkHref ? new urlHelper.URL(linkHref, albumUrl).toString() : null
    const duration = $(el).find('.time').text().trim() || null

    const track = { name: trackName }
    if (trackUrl) track.url = trackUrl
    if (duration) track.duration = duration
    tracks.push(track)
  })

  // Non-playable tracks (fallback for preview albums)
  $('table#track_table tr.track_row_view').each((_, el) => {
    const npName = $(el).find('.title>span:not(.time)').text().trim()
    if (npName && !tracks.some(t => t.name === npName)) {
      tracks.push({ name: npName })
    }
  })

  // Filter out empty-name tracks
  const filteredTracks = tracks.filter(t => t.name !== '')

  const object = {
    tags,
    artist,
    title,
    imageUrl,
    tracks: filteredTracks
  }

  // Parse raw data
  const scriptWithRaw = $('script[data-tralbum]')
  if (scriptWithRaw.length > 0) {
    object.raw = scriptWithRaw.data('tralbum')
  } else {
    let raw = extractJavascriptObjectVariable(html, 'TralbumData')
    // Handle concatenation pattern: "http://example.com" + "/album/name"
    raw = raw ? raw.replace('" + "', '') : ''
    try {
      object.raw = JSON.parse(raw)
    } catch (error) {
      console.error(error)
    }
  }

  object.url = albumUrl
  return object
}

/**
 * Fetches the profile image from a Bandcamp label or artist page.
 * Looks for img.band-photo (the round avatar on the page).
 * @param {string} pageUrl - The Bandcamp page URL
 * @returns {Promise<string|null>} Profile image URL or null
 */
async function getProfileImage (pageUrl) {
  try {
    const html = await fetchPage(pageUrl)
    const $ = cheerio.load(html)
    return $('img.band-photo').attr('src') || null
  } catch {
    return null
  }
}

/**
 * Extracts theme colors from a Bandcamp page's inline CSS.
 * Bandcamp injects custom colors in a style tag targeting #pgBd.
 * @param {string} html - Raw HTML of the Bandcamp page
 * @returns {{ background?: string, body?: string, text?: string, secondary?: string, link?: string, nav?: string, button?: string }}
 */
function extractThemeColors (html) {
  const $ = cheerio.load(html)
  const colors = {}

  // Preferred: parse the data-design JSON attribute (has all colors reliably)
  const designEl = $('[data-design]')
  if (designEl.length) {
    try {
      const design = JSON.parse(designEl.attr('data-design'))
      if (design.bg_color) colors.background = '#' + design.bg_color
      if (design.body_color) colors.body = '#' + design.body_color
      if (design.text_color) colors.text = '#' + design.text_color
      if (design.secondary_text_color) colors.secondary = '#' + design.secondary_text_color
      if (design.link_color) colors.link = '#' + design.link_color
      if (design.hd_ft_color) colors.nav = '#' + design.hd_ft_color
      return colors
    } catch { /* fall through to CSS parsing */ }
  }

  // Fallback: parse inline CSS rules
  $('style').each((_, el) => {
    const css = $(el).html() || ''
    const bgMatch = css.match(/#pgBd\s*\{[^}]*background:\s*(#[0-9a-fA-F]{3,6})/s)
    if (bgMatch) colors.body = bgMatch[1]
    const textMatch = css.match(/#pgBd\s*\{[^}]*\bcolor:\s*(#[0-9a-fA-F]{3,6})/s)
    if (textMatch) colors.text = textMatch[1]
    const linkMatch = css.match(/a\.custom-color[^{]*\{[^}]*\bcolor:\s*(#[0-9a-fA-F]{3,6})/s)
    if (linkMatch) colors.link = linkMatch[1]
    const btnMatch = css.match(/\.g-button[^{]*\{[^}]*background-color:\s*(#[0-9a-fA-F]{3,6})/s)
    if (btnMatch) colors.button = btnMatch[1]
  })

  return colors
}

/**
 * Fetches a Bandcamp page and extracts its theme colors.
 * @param {string} pageUrl - The Bandcamp page URL
 * @returns {Promise<{ background?: string, text?: string, link?: string, button?: string }>}
 */
async function getThemeColors (pageUrl) {
  const html = await fetchPage(pageUrl)
  return extractThemeColors(html)
}

module.exports = {
  getArtistUrls,
  getArtistInfo,
  getAlbumUrls,
  getAlbumInfo,
  getProfileImage,
  getThemeColors,
  extractThemeColors
}
