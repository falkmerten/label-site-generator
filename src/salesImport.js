'use strict'

const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const XLSX = require('xlsx')

// ── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse an RFC 4180 CSV string into an array of string arrays.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv (text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i += 2 } else { inQuotes = false; i++ }
      } else { field += ch; i++ }
    } else {
      if (ch === '"') { inQuotes = true; i++ } else if (ch === ',') { row.push(field); field = ''; i++ } else if (ch === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') i++
        row.push(field); field = ''; rows.push(row); row = []; i++
      } else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++ } else { field += ch; i++ }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/**
 * Parse an XLSX file buffer into string[][].
 * @param {Buffer} buffer
 * @returns {string[][]}
 */
function parseXlsx (buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const name = wb.SheetNames[0]
  if (!name) return []
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
  return rows.map(r => r.map(c => String(c)))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a header index map (lowercase key → column index).
 * @param {string[]} headers
 * @returns {Object<string, number>}
 */
function headerIndex (headers) {
  const map = {}
  for (let i = 0; i < headers.length; i++) {
    map[headers[i].trim().toLowerCase()] = i
  }
  return map
}

/**
 * Get a cell value by header key from a row.
 * @param {string[]} row
 * @param {Object<string, number>} idx - header index map
 * @param {string} key - lowercase header name
 * @returns {string}
 */
function cell (row, idx, key) {
  const i = idx[key]
  if (i === undefined || i >= row.length) return ''
  return (row[i] || '').trim()
}

/**
 * Find a column index by trying multiple aliases.
 * @param {Object<string, number>} idx
 * @param {string[]} aliases
 * @returns {number|undefined}
 */
function findCol (idx, aliases) {
  for (const a of aliases) {
    if (idx[a] !== undefined) return idx[a]
  }
  return undefined
}

/**
 * Parse "Month YYYY" (e.g. "July 2025") into ISO date "YYYY-MM-01".
 * @param {string} period
 * @returns {string|null}
 */
const MONTH_MAP = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
}
function parsePeriodDate (period) {
  if (!period) return null
  const parts = period.trim().split(/\s+/)
  if (parts.length < 2) return null
  const month = MONTH_MAP[parts[0].toLowerCase()]
  const year = parts[1]
  if (!month || !year || !/^\d{4}$/.test(year)) return null
  return `${year}-${month}-01`
}

/**
 * Extract currency code from a header like "Royalty (GBP)" or "Net Amount (EUR)".
 * @param {string[]} headers
 * @returns {string|null}
 */
function extractCurrencyFromHeaders (headers) {
  for (const h of headers) {
    const m = h.match(/\(([A-Z]{3})\)/)
    if (m) return m[1]
  }
  return null
}

// ── Platform-specific parsers ────────────────────────────────────────────────

/**
 * Parse ElasticStage CSV rows.
 * Columns: Period, EAN, Title, Artist, Release Type, Country, Units, Net Amount (GBP), Royalty Rate, Royalty (GBP)
 * @param {string[][]} rawRows - including header row
 * @param {string} filePath
 * @returns {ImportRow[]}
 */
function parseElasticStage (rawRows, filePath) {
  const headers = rawRows[0]
  const idx = headerIndex(headers)
  const currency = extractCurrencyFromHeaders(headers) || 'GBP'

  // Find the royalty column (the one with currency in parens)
  const royaltyCol = findCol(idx, headers
    .map(h => h.trim().toLowerCase())
    .filter(h => h.startsWith('royalty') && h.includes('(')))

  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]
    const artist = cell(row, idx, 'artist')
    const release = cell(row, idx, 'title')
    if (!artist || !release) { logSkip(r, filePath); continue }

    const dateStr = parsePeriodDate(cell(row, idx, 'period'))
    if (!dateStr) { logSkip(r, filePath); continue }

    // Revenue: prefer royalty column, fall back to net amount
    let revenueStr = ''
    if (royaltyCol !== undefined && royaltyCol < row.length) {
      revenueStr = (row[royaltyCol] || '').trim()
    }
    if (!revenueStr) {
      // Try any column with "net amount" or "royalty" in the name
      for (const [key, i] of Object.entries(idx)) {
        if ((key.includes('royalty') || key.includes('net amount')) && i < row.length) {
          revenueStr = (row[i] || '').trim()
          if (revenueStr) break
        }
      }
    }
    const revenue = parseFloat(revenueStr)
    if (isNaN(revenue)) { logSkip(r, filePath); continue }

    const quantity = parseInt(cell(row, idx, 'units'), 10) || 1

    rows.push({
      platform: 'elasticstage', artist, release, revenue, currency,
      quantity, date: dateStr, format: 'physical'
    })
  }
  return rows
}

/**
 * Parse a Discogs description field like "Artist - Title (CD, Album)" into artist and title.
 * @param {string} desc
 * @returns {{ artist: string, title: string }|null}
 */
function parseDiscogsDescription (desc) {
  if (!desc) return null
  // Format: "Artist - Title (Format, Format)"
  // Strip trailing format in parens
  const stripped = desc.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const dashIdx = stripped.indexOf(' - ')
  if (dashIdx === -1) return null
  const artist = stripped.substring(0, dashIdx).trim()
  const title = stripped.substring(dashIdx + 3).trim()
  if (!artist || !title) return null
  return { artist, title }
}

/**
 * Parse Discogs Marketplace CSV rows.
 * Supports two export types:
 * - Order Items export (has `description`, `item_price`, `item_fee` columns)
 * - Orders export (has `total`, `shipping`, `fee` columns, no per-item detail)
 * @param {string[][]} rawRows
 * @param {string} filePath
 * @returns {ImportRow[]}
 */
function parseDiscogs (rawRows, filePath) {
  const headers = rawRows[0]
  const idx = headerIndex(headers)

  // Detect export type by checking for `description` column (order items export)
  const isOrderItems = idx.description !== undefined && idx.item_price !== undefined

  if (isOrderItems) {
    return parseDiscogsOrderItems(rawRows, idx, filePath)
  }
  return parseDiscogsOrders(rawRows, idx, filePath)
}

/**
 * Parse Discogs order items export.
 * Columns: buyer, order_date, order_num, status, order_total, order_fee,
 *          item_id, item_price, item_fee, description, release_id, ..., currency
 */
function parseDiscogsOrderItems (rawRows, idx, filePath) {
  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]
    const dateStr = cell(row, idx, 'order_date')
    if (!dateStr) continue

    const datePart = dateStr.split(' ')[0]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue

    const status = cell(row, idx, 'status').toLowerCase()
    if (status.includes('cancelled') || status === 'merged') continue

    const currency = cell(row, idx, 'currency')
    if (!currency) continue

    const itemPrice = parseFloat(cell(row, idx, 'item_price')) || 0
    const itemFee = parseFloat(cell(row, idx, 'item_fee')) || 0
    if (itemPrice === 0) continue

    const revenue = itemPrice - itemFee

    // Parse artist and title from description
    const desc = cell(row, idx, 'description')
    const parsed = parseDiscogsDescription(desc)

    rows.push({
      platform: 'discogs',
      artist: parsed ? parsed.artist : '(Discogs)',
      release: parsed ? parsed.title : desc || `Item ${cell(row, idx, 'item_id')}`,
      revenue,
      currency,
      quantity: 1,
      date: datePart,
      format: 'physical'
    })
  }
  return rows
}

/**
 * Parse Discogs orders export (no per-item detail).
 * Columns: buyer, order_num, order_date, status, total, shipping, fee, ..., currency
 */
function parseDiscogsOrders (rawRows, idx, filePath) {
  const needed = ['order_date', 'total', 'currency']
  const missing = needed.filter(k => idx[k] === undefined)
  if (missing.length > 0) {
    console.warn(`Warning: Discogs file ${filePath} missing columns: ${missing.join(', ')}, skipping`)
    return []
  }

  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]
    const dateStr = cell(row, idx, 'order_date')
    if (!dateStr) continue

    const datePart = dateStr.split(' ')[0]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue

    const status = cell(row, idx, 'status').toLowerCase()
    if (status.includes('cancelled') || status === 'merged') continue

    const total = parseFloat(cell(row, idx, 'total')) || 0
    const shipping = parseFloat(cell(row, idx, 'shipping')) || 0
    const fee = parseFloat(cell(row, idx, 'fee')) || 0
    const currency = cell(row, idx, 'currency')
    if (!currency || total === 0) continue

    const revenue = total - shipping - fee
    const orderNum = cell(row, idx, 'order_num') || `order-${r}`

    rows.push({
      platform: 'discogs',
      artist: '(Discogs Order)',
      release: `Order #${orderNum}`,
      revenue,
      currency,
      quantity: 1,
      date: datePart,
      format: 'physical'
    })
  }
  return rows
}

/**
 * Parse LabelCaster CSV rows.
 * Columns: label, report_date, sales_start_date, sales_end_date, UPC, release_title,
 *          release_artist, ISRC, track_title, track_artist, channel, configuration,
 *          type, country_code, units, net_royalty_revenue, labelcaster_commission,
 *          total_royalty_revenue, your_split, revenue_entry_id
 * No currency column — defaults to EUR (configurable via options).
 * @param {string[][]} rawRows
 * @param {string} filePath
 * @param {string} defaultCurrency
 * @returns {ImportRow[]}
 */
function parseLabelCaster (rawRows, filePath, defaultCurrency) {
  const headers = rawRows[0]
  const idx = headerIndex(headers)

  const artistCol = findCol(idx, ['release_artist', 'track_artist', 'artist'])
  const releaseCol = findCol(idx, ['release_title', 'title', 'release'])
  const revenueCol = findCol(idx, ['total_royalty_revenue', 'net_royalty_revenue', 'revenue', 'amount'])
  const dateCol = findCol(idx, ['sales_start_date', 'report_date', 'date'])
  const unitsCol = findCol(idx, ['units', 'quantity'])

  if (artistCol === undefined || releaseCol === undefined || revenueCol === undefined || dateCol === undefined) {
    console.warn(`Warning: LabelCaster file ${filePath} missing required columns, skipping`)
    return []
  }

  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]
    const artist = (row[artistCol] || '').trim()
    const release = (row[releaseCol] || '').trim()
    if (!artist || !release) continue

    const revenue = parseFloat((row[revenueCol] || '').trim())
    if (isNaN(revenue)) continue

    const dateStr = (row[dateCol] || '').trim()
    if (!dateStr) continue

    const quantity = parseInt((row[unitsCol] || '').trim(), 10) || 1

    rows.push({
      platform: 'labelcaster', artist, release, revenue,
      currency: defaultCurrency, quantity, date: dateStr, format: 'digital'
    })
  }
  return rows
}

/**
 * Parse Amuse XLSX/CSV rows.
 * Columns: Transaction Date, Type, Source, Royalty Date, Service, Product, UPC, ISRC,
 *          Artist, Release, Track, Quantity, Amount, Split, Total, Payment
 * No currency column — defaults to EUR (configurable via options).
 * @param {string[][]} rawRows
 * @param {string} filePath
 * @param {string} defaultCurrency
 * @returns {ImportRow[]}
 */
function parseAmuse (rawRows, filePath, defaultCurrency) {
  const headers = rawRows[0]
  const idx = headerIndex(headers)

  const artistCol = findCol(idx, ['artist', 'artist_name'])
  const releaseCol = findCol(idx, ['release', 'release_title', 'title', 'album'])
  const revenueCol = findCol(idx, ['total', 'amount', 'revenue', 'earnings'])
  const dateCol = findCol(idx, ['transaction date', 'royalty date', 'date'])
  const quantityCol = findCol(idx, ['quantity', 'qty', 'units'])

  if (artistCol === undefined || releaseCol === undefined || revenueCol === undefined || dateCol === undefined) {
    console.warn(`Warning: Amuse file ${filePath} missing required columns, skipping`)
    return []
  }

  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]
    const artist = (row[artistCol] || '').trim()
    const release = (row[releaseCol] || '').trim()
    if (!artist || !release) continue

    const revenue = parseFloat((row[revenueCol] || '').trim())
    if (isNaN(revenue)) continue

    const dateStr = (row[dateCol] || '').trim()
    if (!dateStr) continue

    const quantity = parseInt((row[quantityCol] || '').trim(), 10) || 1

    rows.push({
      platform: 'amuse', artist, release, revenue,
      currency: defaultCurrency, quantity, date: dateStr, format: 'digital'
    })
  }
  return rows
}

/**
 * Generic fallback parser using flexible column aliases.
 * Used for MakeWaves and any unknown platform.
 * @param {string[][]} rawRows
 * @param {string} platform
 * @param {string} filePath
 * @param {string} defaultCurrency
 * @returns {ImportRow[]}
 */
function parseGeneric (rawRows, platform, filePath, defaultCurrency) {
  const ALIASES = {
    artist: ['artist', 'artist_name', 'artist name', 'band', 'performer', 'release_artist'],
    release: ['release', 'release_title', 'release title', 'title', 'album', 'item', 'item_name', 'product'],
    revenue: ['revenue', 'amount', 'net_amount', 'net amount', 'net', 'total', 'earnings', 'royalty', 'royalties', 'total_royalty_revenue', 'net_royalty_revenue'],
    currency: ['currency', 'currency_code', 'currency code', 'cur'],
    quantity: ['quantity', 'qty', 'units', 'count', 'copies'],
    date: ['date', 'sale_date', 'sale date', 'transaction_date', 'transaction date', 'period', 'report_date', 'sales_start_date']
  }

  const headers = rawRows[0]
  const idx = headerIndex(headers)

  const mapping = {}
  for (const [field, aliases] of Object.entries(ALIASES)) {
    mapping[field] = findCol(idx, aliases)
  }

  if (mapping.artist === undefined || mapping.release === undefined || mapping.revenue === undefined || mapping.date === undefined) {
    console.warn(`Warning: file ${filePath} missing required columns, skipping`)
    return []
  }

  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]
    const artist = (row[mapping.artist] || '').trim()
    const release = (row[mapping.release] || '').trim()
    if (!artist || !release) continue

    const revenue = parseFloat((row[mapping.revenue] || '').trim())
    if (isNaN(revenue)) continue

    let dateStr = (row[mapping.date] || '').trim()
    if (!dateStr) continue
    // Try parsing "Month YYYY" period format
    if (/^[A-Za-z]+ \d{4}$/.test(dateStr)) {
      dateStr = parsePeriodDate(dateStr) || dateStr
    }

    const currency = mapping.currency !== undefined ? (row[mapping.currency] || '').trim() : ''
    const quantity = mapping.quantity !== undefined ? (parseInt((row[mapping.quantity] || '').trim(), 10) || 1) : 1

    rows.push({
      platform, artist, release, revenue,
      currency: currency || defaultCurrency,
      quantity, date: dateStr,
      format: (platform === 'elasticstage' || platform === 'discogs') ? 'physical' : 'digital'
    })
  }
  return rows
}

function logSkip (r, filePath) {
  console.warn(`Warning: skipping unparseable row ${r + 1} in ${filePath}`)
}

// ── Platform router ──────────────────────────────────────────────────────────

/**
 * Route raw rows to the appropriate platform-specific parser.
 * @param {string[][]} rawRows
 * @param {string} platform
 * @param {string} filePath
 * @param {string} defaultCurrency
 * @returns {ImportRow[]}
 */
function parseForPlatform (rawRows, platform, filePath, defaultCurrency) {
  switch (platform) {
    case 'elasticstage': return parseElasticStage(rawRows, filePath)
    case 'discogs': return parseDiscogs(rawRows, filePath)
    case 'labelcaster': return parseLabelCaster(rawRows, filePath, defaultCurrency)
    case 'amuse': return parseAmuse(rawRows, filePath, defaultCurrency)
    default: return parseGeneric(rawRows, platform, filePath, defaultCurrency)
  }
}

// ── File I/O ─────────────────────────────────────────────────────────────────

/**
 * Computes MD5 checksum of a file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function fileChecksum (filePath) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('md5').update(data).digest('hex')
}

/**
 * Loads the import tracking file.
 * @param {string} trackingPath
 * @returns {Promise<Array>}
 */
async function loadTracking (trackingPath) {
  try {
    const text = await fs.readFile(trackingPath, 'utf8')
    const entries = JSON.parse(text)
    return Array.isArray(entries) ? entries : []
  } catch { return [] }
}

/**
 * Saves updated tracking entries.
 * @param {string} trackingPath
 * @param {Array} entries
 */
async function saveTracking (trackingPath, entries) {
  const dir = path.dirname(trackingPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(trackingPath, JSON.stringify(entries, null, 2), 'utf8')
}

/**
 * Reads and parses all CSV/XLSX files from a given import directory.
 * Uses platform-specific parsers for known formats.
 * @param {string} importDir - e.g. "sales/import/elasticstage"
 * @param {string} platform - "elasticstage" | "discogs" | "amuse" | "makewaves" | "labelcaster"
 * @param {Object} options - { force, trackingPath, defaultCurrency }
 * @returns {Promise<ImportRow[]>}
 */
async function importCsvFiles (importDir, platform, options = {}) {
  const {
    force = false,
    trackingPath = 'sales/import/.imported.json',
    defaultCurrency = 'EUR'
  } = options
  const allRows = []

  let files
  try {
    const entries = await fs.readdir(importDir)
    files = entries.filter(f => {
      const lower = f.toLowerCase()
      return lower.endsWith('.csv') || lower.endsWith('.xlsx')
    }).sort()
  } catch { return allRows }

  if (files.length === 0) return allRows

  let tracking = await loadTracking(trackingPath)

  for (const file of files) {
    const filePath = path.join(importDir, file)

    let checksum
    try { checksum = await fileChecksum(filePath) } catch (err) {
      console.warn(`Warning: cannot read ${filePath}: ${err.message}`)
      continue
    }

    if (!force) {
      const existing = tracking.find(e => e.path === filePath && e.checksum === checksum)
      if (existing) continue
    }

    // Read and parse file
    const isXlsx = file.toLowerCase().endsWith('.xlsx')
    let rawRows
    try {
      if (isXlsx) {
        const buffer = await fs.readFile(filePath)
        rawRows = parseXlsx(buffer)
      } else {
        const text = await fs.readFile(filePath, 'utf8')
        rawRows = parseCsv(text)
      }
    } catch (err) {
      console.warn(`Warning: cannot parse ${filePath}: ${err.message}`)
      continue
    }

    if (rawRows.length < 2) {
      console.warn(`Warning: file ${filePath} has no data rows, skipping`)
      continue
    }

    // Route to platform-specific parser
    const rows = parseForPlatform(rawRows, platform, filePath, defaultCurrency)

    allRows.push(...rows)

    // Update tracking
    const existingIdx = tracking.findIndex(e => e.path === filePath)
    const entry = {
      path: filePath,
      checksum,
      importedAt: new Date().toISOString(),
      rowCount: rows.length
    }
    if (existingIdx !== -1) { tracking[existingIdx] = entry } else { tracking.push(entry) }
  }

  await saveTracking(trackingPath, tracking)
  return allRows
}

module.exports = { importCsvFiles, fileChecksum, loadTracking, saveTracking }
