'use strict'

const https = require('https')

// Rate limiting: 2000ms minimum between calls
const MIN_DELAY_MS = 2000
let lastCallTime = 0

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Enforces minimum delay between consecutive calls.
 */
async function enforceRateLimit () {
  const now = Date.now()
  const elapsed = now - lastCallTime
  if (lastCallTime > 0 && elapsed < MIN_DELAY_MS) {
    await delay(MIN_DELAY_MS - elapsed)
  }
  lastCallTime = Date.now()
}

/**
 * Makes an HTTPS POST request and returns the response body as a string.
 */
function httpsPost (url, headers, body) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }

    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    })

    req.on('error', () => resolve(null))
    req.write(body)
    req.end()
  })
}

/**
 * Normalizes a string for comparison: lowercase, strip non-alphanumeric.
 */
function normalize (str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Searches YouTube Music for an album by artist name and album title.
 * Returns the album URL on match, null on no match or error.
 *
 * @param {string} artistName - The artist name to search for
 * @param {string} albumTitle - The album title to search for
 * @returns {Promise<string|null>} YouTube Music album URL or null
 */
async function searchAlbum (artistName, albumTitle) {
  if (!artistName || !albumTitle) return null

  await enforceRateLimit()

  const query = `${artistName} ${albumTitle}`

  const requestBody = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20240101.01.00',
        hl: 'en',
        gl: 'US'
      }
    },
    query,
    params: 'EgWKAQIYAWoMEAMQBBAJEA4QChAF'
  })

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/'
  }

  const url = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false'

  const data = await httpsPost(url, headers, requestBody)
  if (!data) return null

  try {
    // Navigate the response structure to find album results
    const contents = data.contents &&
      data.contents.tabbedSearchResultsRenderer &&
      data.contents.tabbedSearchResultsRenderer.tabs &&
      data.contents.tabbedSearchResultsRenderer.tabs[0] &&
      data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer &&
      data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content &&
      data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer &&
      data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents

    if (!contents || !Array.isArray(contents)) return null

    // Search through shelf renderers for album results
    for (const section of contents) {
      const shelfContents = section.musicShelfRenderer && section.musicShelfRenderer.contents
      if (!shelfContents || !Array.isArray(shelfContents)) continue

      for (const item of shelfContents) {
        const renderer = item.musicResponsiveListItemRenderer
        if (!renderer) continue

        // Extract browse ID (album page)
        const browseId = renderer.navigationEndpoint &&
          renderer.navigationEndpoint.browseEndpoint &&
          renderer.navigationEndpoint.browseEndpoint.browseId

        // Also check overlay/flexColumns for browse endpoint
        const overlayBrowseId = renderer.overlay &&
          renderer.overlay.musicItemThumbnailOverlayRenderer &&
          renderer.overlay.musicItemThumbnailOverlayRenderer.content &&
          renderer.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer &&
          renderer.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint &&
          renderer.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchPlaylistEndpoint &&
          renderer.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchPlaylistEndpoint.playlistId

        const albumBrowseId = browseId || null

        if (!albumBrowseId || !albumBrowseId.startsWith('MPREb_')) continue

        // Extract artist name from flex columns for validation
        const flexColumns = renderer.flexColumns
        if (!flexColumns || !Array.isArray(flexColumns)) continue

        let resultArtist = ''
        for (const col of flexColumns) {
          const runs = col.musicResponsiveListItemFlexColumnRenderer &&
            col.musicResponsiveListItemFlexColumnRenderer.text &&
            col.musicResponsiveListItemFlexColumnRenderer.text.runs
          if (!runs || !Array.isArray(runs)) continue
          for (const run of runs) {
            if (run.navigationEndpoint &&
                run.navigationEndpoint.browseEndpoint &&
                run.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs &&
                run.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig &&
                run.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
              resultArtist = run.text || ''
              break
            }
          }
          if (resultArtist) break
        }

        // Fallback: check second flex column text for artist name
        if (!resultArtist && flexColumns.length > 1) {
          const secondCol = flexColumns[1].musicResponsiveListItemFlexColumnRenderer
          if (secondCol && secondCol.text && secondCol.text.runs) {
            // The artist name is typically in the second column runs
            for (const run of secondCol.text.runs) {
              if (run.text && run.text !== ' • ' && run.text !== ' & ' && run.text !== ', ') {
                resultArtist = run.text
                break
              }
            }
          }
        }

        // Validate: artist name must partially match
        const normalizedSearchArtist = normalize(artistName)
        const normalizedResultArtist = normalize(resultArtist)
        if (!normalizedResultArtist || !normalizedSearchArtist) continue

        const matches = normalizedResultArtist.includes(normalizedSearchArtist) ||
          normalizedSearchArtist.includes(normalizedResultArtist)

        if (matches) {
          return `https://music.youtube.com/browse/${albumBrowseId}`
        }
      }
    }

    return null
  } catch {
    return null
  }
}

module.exports = { searchAlbum }
