'use strict'

const https = require('https')
const http = require('http')
const cheerio = require('cheerio')
const urlHelper = require('url')

/**
 * Fetches a URL over HTTPS, following up to maxRedirects redirects.
 * Returns the response body as a string.
 */
function fetchPage (pageUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const protocol = pageUrl.startsWith('https') ? https : http
    protocol.get(pageUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'))
        const redirectUrl = new URL(res.headers.location, pageUrl).toString()
        res.resume()
        return resolve(fetchPage(redirectUrl, maxRedirects - 1))
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

  // Method 1: Parse the data-blob JSON (contains ALL albums, even those not in <a> tags)
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
      } catch { /* fall through to link parsing */ }
    }
  }

  // Method 2: Fallback to <a> tag parsing if data-blob didn't yield results
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

module.exports = {
  getArtistUrls,
  getArtistInfo,
  getAlbumUrls,
  getAlbumInfo
}
