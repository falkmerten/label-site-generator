'use strict'

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
 * @returns {Promise<Map<string, {bandId: number, subdomain: string, slug: string}>>}
 */
async function resolveRoster (accessToken) {
  const bands = await getMyBands(accessToken)
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
  return roster
}

/**
 * Fetches all sales transactions for a date range, paginating automatically.
 * @param {string} accessToken
 * @param {string} startTime - ISO 8601 start
 * @param {string} endTime - ISO 8601 end
 * @param {number|null} memberBandId - optional filter for single artist
 * @returns {Promise<Array>} array of Transaction objects
 */
async function fetchSalesReport (accessToken, startTime, endTime, memberBandId) {
  const allTransactions = []
  let lastDate = null
  let hasMore = true

  while (hasMore) {
    const body = {
      band_id: memberBandId || 0,
      member_band_id: memberBandId || 0,
      start_time: startTime,
      end_time: endTime
    }
    if (lastDate) {
      body.last_token = lastDate
    }

    const res = await httpsPost('bandcamp.com', '/api/sales/4/sales_report', body, {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    })

    if (res.status !== 200) {
      throw new Error(`Bandcamp Sales API error: HTTP ${res.status}`)
    }

    const report = res.body.report || []
    if (report.length === 0) {
      hasMore = false
      break
    }

    for (const item of report) {
      allTransactions.push({
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
      })
    }

    // If the page returned fewer results than expected, we're done.
    // Otherwise use the last item's date as pagination token.
    if (res.body.more_available === false || report.length === 0) {
      hasMore = false
    } else {
      const lastItem = report[report.length - 1]
      lastDate = lastItem.date || lastItem.paid_to_date || null
      if (!lastDate) hasMore = false
    }
  }

  return allTransactions
}

module.exports = { authenticate, resolveRoster, fetchSalesReport }
