'use strict'

const https = require('https')
const querystring = require('querystring')

/**
 * Makes an HTTPS POST request with form-encoded body.
 */
function httpsPost (hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    let data, contentType
    if (typeof body === 'string') {
      data = body
      contentType = headers['Content-Type'] || 'application/json'
    } else if (headers['Content-Type'] === 'application/x-www-form-urlencoded') {
      data = querystring.stringify(body)
      contentType = 'application/x-www-form-urlencoded'
    } else {
      data = JSON.stringify(body)
      contentType = 'application/json'
    }
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

/**
 * Fetches a client_credentials access token from Bandcamp OAuth.
 */
async function getAccessToken (clientId, clientSecret) {
  const res = await httpsPost('bandcamp.com', '/oauth_token', {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  }, { 'Content-Type': 'application/x-www-form-urlencoded' })
  if (!res.body.ok) {
    throw new Error(`Bandcamp OAuth error: ${res.body.error_description || res.body.error || 'unknown error'}`)
  }
  return res.body.access_token
}

/**
 * Calls the Bandcamp my_bands API endpoint and returns the list of bands.
 * The label account's member_bands are extracted from the label band entry.
 * Also returns the label's own band_id for use with the Sales API.
 * @returns {{ bands: Array, labelBandId: number|null }}
 */
async function getMyBands (accessToken) {
  const res = await httpsPost('bandcamp.com', '/api/account/1/my_bands', {}, {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  })
  if (res.status !== 200) {
    throw new Error(`Bandcamp my_bands API error: HTTP ${res.status}`)
  }
  const bands = res.body.bands || []

  // The label band has a member_bands array — use that as the roster.
  // Fall back to all bands if no label entry is found.
  for (const band of bands) {
    if (band.member_bands && band.member_bands.length > 0) {
      return { bands: band.member_bands, labelBandId: band.band_id }
    }
  }
  return { bands, labelBandId: bands.length > 0 ? bands[0].band_id : null }
}

/**
 * Returns the list of artist Bandcamp URLs for a label account.
 * Uses client_credentials OAuth flow.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<string[]>} Array of Bandcamp URLs like https://artist.bandcamp.com/
 */
async function getLabelArtistUrls (clientId, clientSecret) {
  console.log('Authenticating with Bandcamp API...')
  const accessToken = await getAccessToken(clientId, clientSecret)
  console.log('Fetching label roster via API...')
  const { bands } = await getMyBands(accessToken)
  const urls = bands
    .map(b => b.subdomain ? `https://${b.subdomain}.bandcamp.com/` : null)
    .filter(Boolean)
  console.log(`API returned ${urls.length} artist(s).`)
  return urls
}

module.exports = { getLabelArtistUrls, getAccessToken, getMyBands, httpsPost }
