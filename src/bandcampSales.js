'use strict'

const https = require('https')
const { getAccessToken, getMyBands, httpsPost } = require('./bandcampApi')
const { toSlug } = require('./slugs')

/**
 * Validates env vars and fetches an OAuth2 access token.
 * @returns {Promise<string>} access token
 * @throws {Error} if env vars missing or auth fails
 */
async function authenticate () {
  const clientId = process.env.BANDCAMP_CLIENT_ID
  const clientSecret = process.env.BANDCAMP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Missing BANDCAMP_CLIENT_ID or BANDCAMP_CLIENT_SECRET environment variable')
  }
  return getAccessToken(clientId, clientSecret)
}

/**
 * Resolves artist roster from Bandcamp my_bands API.
 * @param {string} accessToken
 * @returns {Promise<{roster: Map, labelBandId: number|null}>}
 */
async function resolveRoster (accessToken) {
  const { bands, labelBandId } = await getMyBands(accessToken)
  const roster = new Map()
  for (const band of bands) {
    const name = band.name || band.band_name || ''
    if (!name) continue
    roster.set(name, {
      bandId: band.band_id,
      subdomain: band.subdomain || '',
      slug: toSlug(name)
    })
  }
  return { roster, labelBandId }
}

/**
 * Simple HTTPS GET that returns the response body as a string.
 */
function httpsGet (url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject)
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

/**
 * Sleep for ms milliseconds.
 */
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Parse a Bandcamp transaction item into our Transaction format.
 */
function parseTransaction (item) {
  return {
    date: item.date || item.paid_to_date || '',
    artist: item.artist || '',
    itemName: item.item_name || '',
    itemType: item.item_type || '',
    currency: item.currency || '',
    itemPrice: Number(item.item_price) || 0,
    quantity: Number(item.quantity) || 0,
    subTotal: Number(item.sub_total) || 0,
    transactionFee: Number(item.transaction_fee) || 0,
    netAmount: Number(item.net_amount) || 0,
    shipping: Number(item.shipping) || 0,
    package: item.package || '',
    itemUrl: item.item_url || '',
    upc: item.upc || null,
    isrc: item.isrc || null
  }
}

/**
 * Fetches all sales transactions using the async generate/fetch flow.
 * 1. POST generate_sales_report → token
 * 2. Poll fetch_sales_report → download URL
 * 3. Download JSON and parse transactions
 *
 * @param {string} accessToken
 * @param {number} bandId - the label's band_id
 * @param {string} startTime - "YYYY-MM-DD HH:MM:SS"
 * @param {string} endTime - "YYYY-MM-DD HH:MM:SS"
 * @param {number|null} memberBandId - optional single-artist filter
 * @returns {Promise<Array>} Transaction objects
 */
async function fetchSalesReport (accessToken, bandId, startTime, endTime, memberBandId) {
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }

  // 1. Trigger async report generation
  const genBody = {
    band_id: bandId,
    start_time: startTime,
    end_time: endTime,
    format: 'json'
  }
  if (memberBandId) {
    genBody.member_band_id = memberBandId
  }

  const genRes = await httpsPost('bandcamp.com', '/api/sales/4/generate_sales_report', genBody, authHeaders)
  if (genRes.status !== 200 || !genRes.body.token) {
    const errMsg = genRes.body.error_message || genRes.body.error || `HTTP ${genRes.status}`
    throw new Error(`Bandcamp generate_sales_report error: ${errMsg}`)
  }

  const token = genRes.body.token
  console.log(`  Report generation triggered (token: ${token.substring(0, 20)}...)`)

  // 2. Poll for the report URL
  let downloadUrl = null
  const maxAttempts = 30
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(2000) // wait 2s between polls

    const fetchRes = await httpsPost('bandcamp.com', '/api/sales/4/fetch_sales_report', { token }, authHeaders)

    if (fetchRes.body.error && fetchRes.body.error_message === "Report hasn't generated yet") {
      process.stdout.write(`  Waiting for report... (${attempt}/${maxAttempts})\r`)
      continue
    }

    if (fetchRes.body.error) {
      throw new Error(`Bandcamp fetch_sales_report error: ${fetchRes.body.error_message}`)
    }

    if (fetchRes.body.url) {
      downloadUrl = fetchRes.body.url
      console.log('  Report ready, downloading...')
      break
    }
  }

  if (!downloadUrl) {
    throw new Error('Bandcamp sales report generation timed out after 60 seconds')
  }

  // 3. Download and parse the report
  const raw = await httpsGet(downloadUrl)
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Failed to parse Bandcamp sales report JSON')
  }

  const report = data.report || (Array.isArray(data) ? data : [])
  return report.map(parseTransaction).filter(tx => tx.itemName || tx.quantity !== 0 || tx.netAmount !== 0)
}

module.exports = { authenticate, resolveRoster, fetchSalesReport }
