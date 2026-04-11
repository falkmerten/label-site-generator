'use strict'

const fs = require('fs/promises')
const path = require('path')
const { execSync } = require('child_process')
const { toSlug } = require('./slugs')
const bandcampSales = require('./bandcampSales')
const salesImport = require('./salesImport')
const {
  classifyTransaction,
  formatLabel,
  formatDate,
  formatMoney,
  getPeriods,
  renderArtistReport,
  renderBusinessReport
} = require('./salesRenderer')

const VARIOUS_ARTISTS_NAME = 'Various Artists'
const VARIOUS_ARTISTS_SLUG = 'various-artists'

/**
 * Fallback exchange rates to EUR (used when ECB API is unavailable).
 * Override via SALES_EXCHANGE_RATES env var as JSON, e.g. '{"GBP":1.17,"USD":0.92}'
 */
const FALLBACK_RATES = { GBP: 1.17, USD: 0.92 }

/**
 * Fetch monthly average exchange rates from the ECB Data Portal.
 * Returns a map like { "GBP": { "2025-01": 1.18, "2025-02": 1.17, ... }, "USD": { ... } }
 * @param {string[]} currencies - e.g. ["GBP", "USD"]
 * @param {number} startYear
 * @param {number} endYear
 * @returns {Promise<Object>}
 */
async function fetchEcbRates (currencies, startYear, endYear) {
  const https = require('https')
  const currencyKeys = currencies.join('+')
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/M.${currencyKeys}.EUR.SP00.A?startPeriod=${startYear}-01&endPeriod=${endYear}-12&format=csvdata`

  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        console.warn(`  ECB API returned HTTP ${res.statusCode}, using fallback rates`)
        resolve(null)
        return
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const rates = {}
          const lines = data.split('\n')
          // CSV header: KEY,FREQ,CURRENCY,CURRENCY_DENOM,...,TIME_PERIOD,OBS_VALUE,...
          const header = lines[0].split(',')
          const currCol = header.indexOf('CURRENCY')
          const periodCol = header.indexOf('TIME_PERIOD')
          const valueCol = header.indexOf('OBS_VALUE')
          if (currCol === -1 || periodCol === -1 || valueCol === -1) {
            resolve(null)
            return
          }
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',')
            if (cols.length <= valueCol) continue
            const cur = cols[currCol]
            const period = cols[periodCol] // "2025-01"
            const value = parseFloat(cols[valueCol])
            if (!cur || !period || isNaN(value)) continue
            // ECB gives "1 EUR = X foreign currency", we need the inverse: "1 foreign = 1/X EUR"
            if (!rates[cur]) rates[cur] = {}
            rates[cur][period] = Math.round((1 / value) * 10000) / 10000
          }
          resolve(rates)
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => {
      console.warn('  ECB API unreachable, using fallback rates')
      resolve(null)
    })
  })
}

/**
 * Get exchange rates — tries ECB API first, falls back to fixed rates.
 * @param {number} startYear
 * @param {number} endYear
 * @returns {Promise<{ monthly: Object|null, fallback: Object }>}
 */
async function getExchangeRates (startYear, endYear) {
  // Check for manual override
  let fallback = FALLBACK_RATES
  try {
    const env = process.env.SALES_EXCHANGE_RATES
    if (env) fallback = { ...FALLBACK_RATES, ...JSON.parse(env) }
  } catch {}

  // Try ECB API for monthly rates
  console.log('Fetching ECB exchange rates...')
  const monthly = await fetchEcbRates(Object.keys(fallback), startYear, endYear)
  if (monthly) {
    const currencies = Object.keys(monthly)
    const periods = currencies.length > 0 ? Object.keys(monthly[currencies[0]]).length : 0
    console.log(`  Loaded ${periods} monthly rates for ${currencies.join(', ')}`)
  }
  return { monthly, fallback }
}

/**
 * Convert an ImportRow's currency to EUR.
 * Uses monthly ECB rate if available, otherwise falls back to fixed rate.
 * @param {object} row - ImportRow with date and currency
 * @param {{ monthly: Object|null, fallback: Object }} rates
 * @returns {object} row with converted revenue and currency set to EUR
 */
function convertToEur (row, rates) {
  if (row.currency === 'EUR' || !row.currency) return row

  // Try monthly rate based on the row's date
  let rate = null
  if (rates.monthly && rates.monthly[row.currency]) {
    // Extract YYYY-MM from the date
    const match = (row.date || '').match(/^(\d{4}-\d{2})/)
    if (match) {
      rate = rates.monthly[row.currency][match[1]]
    }
  }

  // Fall back to fixed rate
  if (!rate) {
    rate = rates.fallback[row.currency]
  }

  if (!rate) return row // unknown currency, leave as-is
  return { ...row, revenue: Math.round(row.revenue * rate * 100) / 100, currency: 'EUR' }
}

const IMPORT_PLATFORMS = [
  { platform: 'elasticstage', dir: 'sales/import/elasticstage' },
  { platform: 'discogs', dir: 'sales/import/discogs' },
  { platform: 'amuse', dir: 'sales/import/amuse' },
  { platform: 'makewaves', dir: 'sales/import/makewaves' },
  { platform: 'labelcaster', dir: 'sales/import/labelcaster' }
]

/**
 * Check if .gitignore contains a sales/ entry. Log warning if missing.
 */
async function checkGitignore () {
  try {
    const text = await fs.readFile('.gitignore', 'utf8')
    const lines = text.split('\n').map(l => l.trim())
    const hasSales = lines.some(l => l === 'sales/' || l === 'sales' || l === '/sales/' || l === '/sales')
    if (!hasSales) {
      console.warn('Warning: sales/ is not in .gitignore. Financial data may be committed to version control.')
    }
  } catch {
    console.warn('Warning: sales/ is not in .gitignore. Financial data may be committed to version control.')
  }
}

/**
 * Build a slug-based lookup map from the roster for case-insensitive matching.
 * @param {Map<string, {bandId, subdomain, slug}>} roster
 * @returns {Map<string, {name: string, slug: string, bandId: number}>}
 */
function buildRosterLookup (roster) {
  const lookup = new Map()
  for (const [name, info] of roster) {
    const slug = info.slug || toSlug(name)
    lookup.set(slug, { name, slug, bandId: info.bandId })
  }
  return lookup
}

/**
 * Match an artist name against the roster using case-insensitive slug comparison.
 * @param {string} artistName
 * @param {Map<string, {name, slug, bandId}>} rosterLookup - keyed by slug
 * @returns {{ name: string, slug: string }|null}
 */
function matchArtist (artistName, rosterLookup) {
  if (!artistName) return null
  const slug = toSlug(artistName)
  if (!slug) return null
  const entry = rosterLookup.get(slug)
  if (entry) return { name: entry.name, slug: entry.slug }
  // Fallback: strip parenthetical suffixes like "(2)", "(UK)", "(Remix)" and retry
  const stripped = artistName.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (stripped !== artistName) {
    const strippedSlug = toSlug(stripped)
    const fallback = rosterLookup.get(strippedSlug)
    if (fallback) return { name: fallback.name, slug: fallback.slug }
  }
  return null
}

/**
 * Filter transactions to a specific period.
 * @param {Array} transactions
 * @param {Date} start
 * @param {Date} end
 * @returns {Array}
 */
function filterByPeriod (transactions, start, end) {
  return transactions.filter(t => {
    const d = new Date(t.date)
    return d >= start && d <= end
  })
}

/**
 * Filter import rows to a specific period.
 * @param {Array} rows
 * @param {Date} start
 * @param {Date} end
 * @returns {Array}
 */
function filterImportRowsByPeriod (rows, start, end) {
  return rows.filter(r => {
    const d = new Date(r.date)
    return d >= start && d <= end
  })
}

/**
 * Group Bandcamp transactions by artist slug.
 * Non-roster artists go to "various-artists".
 * @param {Array} transactions
 * @param {Map} rosterLookup
 * @returns {Map<string, { name: string, transactions: Array }>}
 */
function groupTransactionsByArtist (transactions, rosterLookup) {
  const groups = new Map()

  for (const tx of transactions) {
    const match = matchArtist(tx.artist, rosterLookup)
    const slug = match ? match.slug : VARIOUS_ARTISTS_SLUG
    const name = match ? match.name : VARIOUS_ARTISTS_NAME

    if (!groups.has(slug)) {
      groups.set(slug, { name, transactions: [] })
    }
    groups.get(slug).transactions.push(tx)
  }

  return groups
}

/**
 * Group import rows by artist slug.
 * Non-roster artists go to "various-artists".
 * @param {Array} rows
 * @param {Map} rosterLookup
 * @returns {Map<string, { name: string, rows: Array }>}
 */
function groupImportRowsByArtist (rows, rosterLookup) {
  const groups = new Map()

  for (const row of rows) {
    const match = matchArtist(row.artist, rosterLookup)
    const slug = match ? match.slug : VARIOUS_ARTISTS_SLUG
    const name = match ? match.name : VARIOUS_ARTISTS_NAME

    if (!groups.has(slug)) {
      groups.set(slug, { name, rows: [] })
    }
    groups.get(slug).rows.push(row)
  }

  return groups
}

/**
 * Build ArtistReportData for a single artist and period.
 * @param {string} artistName
 * @param {string} artistSlug
 * @param {number} year
 * @param {{ label: string, suffix: string }} period
 * @param {Array} transactions - Bandcamp transactions for this artist+period
 * @param {Array} esRows - ElasticStage import rows for this artist+period
 * @param {Object} distRows - { amuse: [], makewaves: [], labelcaster: [] } for this artist+period
 * @returns {object} ArtistReportData
 */
function buildArtistReportData (artistName, artistSlug, year, period, transactions, esRows, distRows) {
  const physical = {}
  const digital = {}

  for (const tx of transactions) {
    const type = classifyTransaction(tx)
    const cur = tx.currency || 'EUR'

    if (type === 'physical') {
      if (!physical[cur]) physical[cur] = []
      physical[cur].push({
        date: tx.date,
        item: tx.itemName,
        format: formatLabel(tx.package),
        qty: tx.quantity,
        price: tx.itemPrice,
        shipping: tx.shipping,
        bcFee: Math.round((tx.subTotal - tx.transactionFee - tx.netAmount) * 100) / 100,
        txFee: tx.transactionFee,
        net: tx.netAmount
      })
    } else {
      if (!digital[cur]) digital[cur] = []
      digital[cur].push({
        date: tx.date,
        item: tx.itemName,
        qty: tx.quantity,
        price: tx.itemPrice,
        bcFee: Math.round((tx.subTotal - tx.transactionFee - tx.netAmount) * 100) / 100,
        txFee: tx.transactionFee,
        net: tx.netAmount
      })
    }
  }

  // Build distributor summaries
  const distributors = {}
  for (const [platform, rows] of Object.entries(distRows)) {
    if (rows.length > 0) {
      distributors[platform] = rows.map(r => ({
        artist: r.artist,
        release: r.release,
        revenue: r.revenue,
        currency: r.currency
      }))
    }
  }

  // Calculate totals per currency
  const totals = {}

  const addToTotal = (cur, field, amount) => {
    if (!totals[cur]) {
      totals[cur] = { physical: 0, digital: 0, elasticstage: 0, distributors: 0, total: 0 }
    }
    totals[cur][field] += amount
    totals[cur].total += amount
  }

  for (const [cur, items] of Object.entries(physical)) {
    for (const item of items) {
      addToTotal(cur, 'physical', item.net)
    }
  }

  for (const [cur, items] of Object.entries(digital)) {
    for (const item of items) {
      addToTotal(cur, 'digital', item.net)
    }
  }

  for (const row of esRows) {
    addToTotal(row.currency, 'elasticstage', row.revenue)
  }

  for (const rows of Object.values(distRows)) {
    for (const row of rows) {
      addToTotal(row.currency, 'distributors', row.revenue)
    }
  }

  return {
    artistName,
    artistSlug,
    year,
    periodLabel: period.label,
    periodSuffix: period.suffix,
    generatedAt: formatDate(new Date()),
    physical,
    digital,
    elasticstage: esRows,
    distributors,
    totals
  }
}

/**
 * Build BusinessReportData from all transactions and import data.
 * @param {number} year
 * @param {Array} allTransactions
 * @param {Array} allEsRows
 * @param {Object} allDistRows - { amuse: [], makewaves: [], labelcaster: [] }
 * @returns {object} BusinessReportData
 */
function buildBusinessReportData (year, allTransactions, allEsRows, allDistRows) {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  // Summary per currency
  const summary = {}
  const artistTotals = {} // key: artistName, value: { physical, digital, total, currency }
  const releaseTotals = {} // key: artist|release, value: { artist, release, units, revenue, currency }
  const monthTotals = {} // key: monthIndex, value: { physical, digital, total, currency }
  const sourceTotals = {} // key: source, value: { revenue, currency }

  // Process Bandcamp transactions
  for (const tx of allTransactions) {
    const cur = tx.currency || 'EUR'
    if (!summary[cur]) {
      summary[cur] = { revenue: 0, units: 0, transactions: 0, physical: 0, digital: 0 }
    }
    summary[cur].revenue += tx.netAmount
    summary[cur].units += Math.abs(tx.quantity)
    summary[cur].transactions += 1

    const type = classifyTransaction(tx)
    if (type === 'physical') {
      summary[cur].physical += tx.netAmount
      const srcKey = `Bandcamp Physical|${cur}`
      if (!sourceTotals[srcKey]) sourceTotals[srcKey] = { source: 'Bandcamp Physical', revenue: 0, currency: cur }
      sourceTotals[srcKey].revenue += tx.netAmount
    } else {
      summary[cur].digital += tx.netAmount
      const srcKey = `Bandcamp Digital|${cur}`
      if (!sourceTotals[srcKey]) sourceTotals[srcKey] = { source: 'Bandcamp Digital', revenue: 0, currency: cur }
      sourceTotals[srcKey].revenue += tx.netAmount
    }

    // Artist totals
    const artistKey = `${tx.artist}|${cur}`
    if (!artistTotals[artistKey]) {
      artistTotals[artistKey] = { artist: tx.artist, physical: 0, digital: 0, total: 0, currency: cur }
    }
    artistTotals[artistKey].total += tx.netAmount
    if (type === 'physical') {
      artistTotals[artistKey].physical += tx.netAmount
    } else {
      artistTotals[artistKey].digital += tx.netAmount
    }

    // Release totals
    const releaseKey = `${tx.artist}|${tx.itemName}|${cur}`
    if (!releaseTotals[releaseKey]) {
      releaseTotals[releaseKey] = { artist: tx.artist, release: tx.itemName, units: 0, revenue: 0, currency: cur }
    }
    releaseTotals[releaseKey].units += Math.abs(tx.quantity)
    releaseTotals[releaseKey].revenue += tx.netAmount

    // Month totals
    const d = new Date(tx.date)
    const monthIdx = d.getUTCMonth()
    const monthKey = `${monthIdx}|${cur}`
    if (!monthTotals[monthKey]) {
      monthTotals[monthKey] = { month: MONTH_NAMES[monthIdx], physical: 0, digital: 0, total: 0, currency: cur, monthIdx }
    }
    monthTotals[monthKey].total += tx.netAmount
    if (type === 'physical') {
      monthTotals[monthKey].physical += tx.netAmount
    } else {
      monthTotals[monthKey].digital += tx.netAmount
    }
  }

  // Process ElasticStage rows
  for (const row of allEsRows) {
    const cur = row.currency || 'EUR'
    if (!summary[cur]) {
      summary[cur] = { revenue: 0, units: 0, transactions: 0, physical: 0, digital: 0 }
    }
    summary[cur].revenue += row.revenue
    summary[cur].units += row.quantity
    summary[cur].transactions += 1
    summary[cur].physical += row.revenue

    const srcKey = `ElasticStage|${cur}`
    if (!sourceTotals[srcKey]) sourceTotals[srcKey] = { source: 'ElasticStage', revenue: 0, currency: cur }
    sourceTotals[srcKey].revenue += row.revenue

    const artistKey = `${row.artist}|${cur}`
    if (!artistTotals[artistKey]) {
      artistTotals[artistKey] = { artist: row.artist, physical: 0, digital: 0, total: 0, currency: cur }
    }
    artistTotals[artistKey].physical += row.revenue
    artistTotals[artistKey].total += row.revenue

    const releaseKey = `${row.artist}|${row.release}|${cur}`
    if (!releaseTotals[releaseKey]) {
      releaseTotals[releaseKey] = { artist: row.artist, release: row.release, units: 0, revenue: 0, currency: cur }
    }
    releaseTotals[releaseKey].units += row.quantity
    releaseTotals[releaseKey].revenue += row.revenue
  }

  // Process distributor rows
  for (const [platform, rows] of Object.entries(allDistRows)) {
    const sourceName = platform.charAt(0).toUpperCase() + platform.slice(1)
    for (const row of rows) {
      const cur = row.currency || 'EUR'
      if (!summary[cur]) {
        summary[cur] = { revenue: 0, units: 0, transactions: 0, physical: 0, digital: 0 }
      }
      summary[cur].revenue += row.revenue
      summary[cur].units += row.quantity
      summary[cur].transactions += 1
      summary[cur].digital += row.revenue

      const srcKey = `${sourceName}|${cur}`
      if (!sourceTotals[srcKey]) sourceTotals[srcKey] = { source: sourceName, revenue: 0, currency: cur }
      sourceTotals[srcKey].revenue += row.revenue

      const artistKey = `${row.artist}|${cur}`
      if (!artistTotals[artistKey]) {
        artistTotals[artistKey] = { artist: row.artist, physical: 0, digital: 0, total: 0, currency: cur }
      }
      artistTotals[artistKey].digital += row.revenue
      artistTotals[artistKey].total += row.revenue

      const releaseKey = `${row.artist}|${row.release}|${cur}`
      if (!releaseTotals[releaseKey]) {
        releaseTotals[releaseKey] = { artist: row.artist, release: row.release, units: 0, revenue: 0, currency: cur }
      }
      releaseTotals[releaseKey].units += row.quantity
      releaseTotals[releaseKey].revenue += row.revenue
    }
  }

  // Build revenue by month (ensure 12 rows)
  const revenueByMonth = []
  // Determine the primary currency (most transactions)
  const primaryCur = Object.keys(summary).sort((a, b) => summary[b].transactions - summary[a].transactions)[0] || 'EUR'
  for (let i = 0; i < 12; i++) {
    const key = `${i}|${primaryCur}`
    if (monthTotals[key]) {
      revenueByMonth.push({
        month: MONTH_NAMES[i],
        physical: monthTotals[key].physical,
        digital: monthTotals[key].digital,
        total: monthTotals[key].total,
        currency: primaryCur
      })
    } else {
      revenueByMonth.push({
        month: MONTH_NAMES[i],
        physical: 0,
        digital: 0,
        total: 0,
        currency: primaryCur
      })
    }
  }

  return {
    year,
    generatedAt: formatDate(new Date()),
    summary,
    revenueByArtist: Object.values(artistTotals),
    revenueBySource: Object.values(sourceTotals),
    revenueByMonth,
    topReleases: Object.values(releaseTotals)
  }
}

/**
 * Write a report to disk or stdout. Tracks written files for PDF conversion.
 * @param {string} filePath
 * @param {string} content
 * @param {boolean} dryRun
 * @param {string[]} writtenFiles - array to push written paths into
 */
async function writeReport (filePath, content, dryRun, writtenFiles) {
  if (dryRun) {
    console.log(`\n--- ${filePath} ---`)
    console.log(content)
    return
  }
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  console.log(`  Written: ${filePath}`)
  if (writtenFiles) writtenFiles.push(filePath)
}

/**
 * Sync generated sales reports and tracking file to S3.
 * Uses `aws s3 sync` CLI, excluding CSV import source files.
 * Only uploads new or modified files (checksum comparison via S3 ETag).
 */
function syncSalesReportsToS3 () {
  const bucket = process.env.STORAGE_S3_BUCKET
  if (!bucket) {
    console.error('S3 sync requires STORAGE_S3_BUCKET to be configured')
    process.exit(1)
  }

  const prefix = process.env.STORAGE_S3_PREFIX || ''
  const s3Path = `s3://${bucket}/${prefix}sales/`

  console.log(`\nSyncing sales/ to ${s3Path} ...`)

  const output = execSync(
    `aws s3 sync sales/ ${s3Path} --exclude "import/*" --size-only`,
    { encoding: 'utf8' }
  )

  // Count uploaded files and estimate bytes from output lines
  const uploadLines = output.split('\n').filter(l => l.startsWith('upload:'))
  let totalBytes = 0
  for (const line of uploadLines) {
    // aws s3 sync output format: "upload: sales/file.md to s3://... "
    // Extract local file path to get size
    const match = line.match(/^upload:\s+(\S+)/)
    if (match) {
      try {
        const stat = require('fs').statSync(match[1])
        totalBytes += stat.size
      } catch {
        // File may have been removed between sync and stat; skip
      }
    }
  }

  console.log(`S3 sync complete: ${uploadLines.length} file(s) uploaded, ${totalBytes} bytes transferred`)
}

/**
 * Convert specific .md report files to PDF using md-to-pdf.
 * @param {string[]} mdFiles - paths to .md files to convert
 */
async function convertReportsToPdf (mdFiles) {
  const { mdToPdf } = require('md-to-pdf')

  if (mdFiles.length === 0) {
    console.log('No reports to convert.')
    return
  }

  console.log(`\nConverting ${mdFiles.length} reports to PDF...`)
  let converted = 0
  for (const mdFile of mdFiles) {
    const pdfFile = mdFile.replace(/\.md$/, '.pdf')
    try {
      await mdToPdf({ path: mdFile }, { dest: pdfFile, stylesheet: [], pdf_options: { format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } } })
      converted++
    } catch (err) {
      console.warn(`  Warning: failed to convert ${mdFile}: ${err.message}`)
    }
  }
  console.log(`  Converted ${converted} PDF(s)`)
}

/**
 * Generate reports for a single year given shared auth/roster/CSV data.
 */
async function generateForYear (year, accessToken, labelBandId, memberBandId, rosterLookup, allEsRows, allDistRows, period, businessReport, dryRun, artistFilter, writtenFiles) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Year ${year}`)
  console.log(`${'═'.repeat(60)}`)

  // Fetch Bandcamp transactions for this year
  const startTime = `${year}-01-01 00:00:00`
  const endTime = `${year}-12-31 23:59:59`
  console.log(`Fetching Bandcamp sales for ${year}...`)
  const yearTransactions = await bandcampSales.fetchSalesReport(accessToken, labelBandId, startTime, endTime, memberBandId)
  console.log(`  Fetched ${yearTransactions.length} Bandcamp transactions`)

  const periods = getPeriods(year, period)

  // Group Bandcamp transactions by artist
  const txByArtist = groupTransactionsByArtist(yearTransactions, rosterLookup)

  // Filter CSV import rows to this year
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59))
  const yearEsRows = filterImportRowsByPeriod(allEsRows, yearStart, yearEnd)
  const esByArtist = groupImportRowsByArtist(yearEsRows, rosterLookup)

  const yearDistRows = {}
  for (const [platform, rows] of Object.entries(allDistRows)) {
    yearDistRows[platform] = filterImportRowsByPeriod(rows, yearStart, yearEnd)
  }

  const distByArtist = {}
  for (const [platform, rows] of Object.entries(yearDistRows)) {
    const grouped = groupImportRowsByArtist(rows, rosterLookup)
    for (const [slug, data] of grouped) {
      if (!distByArtist[slug]) {
        distByArtist[slug] = { name: data.name, discogs: [], amuse: [], makewaves: [], labelcaster: [] }
      }
      distByArtist[slug][platform] = data.rows
    }
  }

  const allSlugs = new Set()
  for (const slug of txByArtist.keys()) allSlugs.add(slug)
  for (const slug of esByArtist.keys()) allSlugs.add(slug)
  for (const slug of Object.keys(distByArtist)) allSlugs.add(slug)

  if (artistFilter) {
    const match = matchArtist(artistFilter, rosterLookup)
    if (match) {
      for (const slug of allSlugs) { if (slug !== match.slug) allSlugs.delete(slug) }
    }
  }

  if (allSlugs.size === 0) {
    console.log('  No data for this year, skipping.')
    return { reports: 0, transactions: yearTransactions.length }
  }

  console.log(`Generating reports for ${allSlugs.size} artist(s), ${periods.length} period(s)...`)
  let reports = 0

  for (const slug of [...allSlugs].sort()) {
    if (slug === VARIOUS_ARTISTS_SLUG) {
      const vaTx = txByArtist.get(slug)
      const vaEs = esByArtist.get(slug)
      const vaDist = distByArtist[slug]
      const hasData = (vaTx && vaTx.transactions.length > 0) ||
                      (vaEs && vaEs.rows.length > 0) ||
                      (vaDist && (vaDist.discogs.length > 0 || vaDist.amuse.length > 0 || vaDist.makewaves.length > 0 || vaDist.labelcaster.length > 0))
      if (!hasData) continue
    }

    const artistTx = txByArtist.get(slug)
    const artistEs = esByArtist.get(slug)
    const artistDist = distByArtist[slug]
    const artistName = (artistTx && artistTx.name) || (artistEs && artistEs.name) || (artistDist && artistDist.name) || slug

    for (const p of periods) {
      const periodTx = artistTx ? filterByPeriod(artistTx.transactions, p.start, p.end) : []
      const periodEs = artistEs ? filterImportRowsByPeriod(artistEs.rows, p.start, p.end) : []
      const periodDist = {
        discogs: artistDist ? filterImportRowsByPeriod(artistDist.discogs, p.start, p.end) : [],
        amuse: artistDist ? filterImportRowsByPeriod(artistDist.amuse, p.start, p.end) : [],
        makewaves: artistDist ? filterImportRowsByPeriod(artistDist.makewaves, p.start, p.end) : [],
        labelcaster: artistDist ? filterImportRowsByPeriod(artistDist.labelcaster, p.start, p.end) : []
      }

      const reportData = buildArtistReportData(artistName, slug, year, p, periodTx, periodEs, periodDist)
      const markdown = renderArtistReport(reportData)
      await writeReport(`sales/${slug}/${slug}-${p.suffix}.md`, markdown, dryRun, writtenFiles)
      reports++
    }
  }

  if (businessReport) {
    console.log('Generating business report...')
    const bizData = buildBusinessReportData(year, yearTransactions, yearEsRows, yearDistRows)
    await writeReport(`sales/business-report-${year}.md`, renderBusinessReport(bizData), dryRun, writtenFiles)
    reports++
  }

  return { reports, transactions: yearTransactions.length }
}

/**
 * Main entry point for sales report generation.
 * Authenticates once, imports CSVs once, loops through years.
 * @param {object} options
 */
async function generateSalesReports (options) {
  const {
    years,
    year,
    artistFilter = null,
    period = 'annual',
    businessReport = false,
    dryRun = false,
    force = false,
    syncS3 = false,
    pdf = false
  } = options

  const yearList = years || [year]

  await checkGitignore()

  console.log('Authenticating with Bandcamp...')
  const accessToken = await bandcampSales.authenticate()

  console.log('Resolving artist roster...')
  const { roster, labelBandId } = await bandcampSales.resolveRoster(accessToken)
  const rosterLookup = buildRosterLookup(roster)

  let memberBandId = null
  if (artistFilter) {
    const match = matchArtist(artistFilter, rosterLookup)
    if (!match) throw new Error(`Artist not found: ${artistFilter}`)
    const entry = rosterLookup.get(match.slug)
    if (entry) memberBandId = entry.bandId
  }

  // Import CSV data once
  const trackingPath = 'sales/import/.imported.json'
  let allEsRows = []
  const allDistRows = { discogs: [], amuse: [], makewaves: [], labelcaster: [] }

  for (const { platform, dir } of IMPORT_PLATFORMS) {
    console.log(`Importing ${platform} CSV files...`)
    const rows = await salesImport.importCsvFiles(dir, platform, { force, trackingPath })
    if (platform === 'elasticstage') {
      allEsRows = allEsRows.concat(rows)
    } else {
      allDistRows[platform] = rows
    }
    if (rows.length > 0) console.log(`  Imported ${rows.length} rows from ${platform}`)
  }

  // Convert non-EUR currencies to EUR using ECB monthly rates (fallback: fixed rates)
  const rates = await getExchangeRates(yearList[0], yearList[yearList.length - 1])
  allEsRows = allEsRows.map(r => convertToEur(r, rates))
  for (const platform of Object.keys(allDistRows)) {
    allDistRows[platform] = allDistRows[platform].map(r => convertToEur(r, rates))
  }

  let totalReports = 0
  let totalTransactions = 0
  const writtenFiles = []

  for (const y of yearList) {
    const result = await generateForYear(y, accessToken, labelBandId, memberBandId, rosterLookup, allEsRows, allDistRows, period, businessReport, dryRun, artistFilter, writtenFiles)
    totalReports += result.reports
    totalTransactions += result.transactions
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Generated ${totalReports} reports across ${yearList.length} year(s), ${totalTransactions} Bandcamp transactions`)

  if (!dryRun && pdf) {
    await convertReportsToPdf(writtenFiles)
  }

  if (!dryRun && (syncS3 || process.env.STORAGE_MODE === 's3')) {
    syncSalesReportsToS3()
  }

  return { reportsGenerated: totalReports, transactionCount: totalTransactions }
}

module.exports = { generateSalesReports }
