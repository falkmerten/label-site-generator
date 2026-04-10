'use strict'

const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { toSlug } = require('./slugs')

/**
 * Parse an RFC 4180 CSV string into an array of string arrays.
 * Handles quoted fields containing commas, double-quotes, and newlines.
 * @param {string} text - Raw CSV text
 * @returns {string[][]} Array of rows, each row an array of field values
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
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        row.push(field)
        field = ''
        i++
      } else if (ch === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') i++
        row.push(field)
        field = ''
        rows.push(row)
        row = []
        i++
      } else if (ch === '\n') {
        row.push(field)
        field = ''
        rows.push(row)
        row = []
        i++
      } else {
        field += ch
        i++
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/**
 * Flexible column name aliases for mapping CSV headers to ImportRow fields.
 * Each key is the ImportRow field; values are lowercase aliases to match against.
 */
const COLUMN_ALIASES = {
  artist: ['artist', 'artist_name', 'artist name', 'band', 'performer'],
  release: ['release', 'release_title', 'release title', 'title', 'album', 'track', 'item', 'item_name', 'item name', 'product'],
  revenue: ['revenue', 'amount', 'net_amount', 'net amount', 'net', 'total', 'earnings', 'royalty', 'royalties', 'label_share', 'label share'],
  currency: ['currency', 'currency_code', 'currency code', 'cur'],
  quantity: ['quantity', 'qty', 'units', 'count', 'copies'],
  date: ['date', 'sale_date', 'sale date', 'transaction_date', 'transaction date', 'period', 'report_date', 'report date'],
  format: ['format', 'type', 'product_type', 'product type', 'media']
}

const REQUIRED_FIELDS = ['artist', 'release', 'revenue', 'currency', 'date']

/**
 * Build a mapping from ImportRow field names to column indices based on CSV headers.
 * @param {string[]} headers - Lowercase-trimmed header row
 * @returns {{ mapping: Object<string, number>, missing: string[] }}
 */
function mapColumns (headers) {
  const mapping = {}
  const lowerHeaders = headers.map(h => h.trim().toLowerCase())

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = lowerHeaders.findIndex(h => aliases.includes(h))
    if (idx !== -1) {
      mapping[field] = idx
    }
  }

  const missing = REQUIRED_FIELDS.filter(f => mapping[f] === undefined)
  return { mapping, missing }
}

/**
 * Parse a single CSV row into an ImportRow object.
 * @param {string[]} row - Raw CSV row values
 * @param {Object<string, number>} mapping - Column index mapping
 * @param {string} platform - Platform identifier
 * @returns {ImportRow|null} Parsed row or null if unparseable
 */
function parseRow (row, mapping, platform) {
  const get = (field) => {
    const idx = mapping[field]
    if (idx === undefined || idx >= row.length) return ''
    return (row[idx] || '').trim()
  }

  const artist = get('artist')
  const release = get('release')
  const revenueStr = get('revenue')
  const currency = get('currency')
  const dateStr = get('date')
  const quantityStr = get('quantity')
  const formatStr = get('format')

  if (!artist || !release) return null

  const revenue = parseFloat(revenueStr)
  if (isNaN(revenue)) return null

  if (!currency) return null

  // Quantity defaults to 1 if missing or unparseable
  let quantity = parseInt(quantityStr, 10)
  if (isNaN(quantity)) quantity = 1

  // Date: accept as-is if non-empty, skip row if empty
  if (!dateStr) return null

  // Format: default based on platform
  let format = 'digital'
  if (formatStr) {
    const lower = formatStr.toLowerCase()
    if (lower === 'physical' || lower === 'cd' || lower === 'vinyl' || lower === 'cassette') {
      format = 'physical'
    } else if (lower === 'digital' || lower === 'download' || lower === 'stream' || lower === 'streaming') {
      format = 'digital'
    } else {
      format = lower
    }
  } else if (platform === 'elasticstage' || platform === 'discogs') {
    format = 'physical'
  }

  return { platform, artist, release, revenue, currency, quantity, date: dateStr, format }
}

/**
 * Computes MD5 checksum of a file.
 * @param {string} filePath
 * @returns {Promise<string>} hex-encoded MD5 checksum
 */
async function fileChecksum (filePath) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('md5').update(data).digest('hex')
}

/**
 * Loads the import tracking file.
 * @param {string} trackingPath - Path to .imported.json
 * @returns {Promise<ImportEntry[]>}
 */
async function loadTracking (trackingPath) {
  try {
    const text = await fs.readFile(trackingPath, 'utf8')
    const entries = JSON.parse(text)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/**
 * Saves updated tracking entries.
 * @param {string} trackingPath - Path to .imported.json
 * @param {ImportEntry[]} entries
 */
async function saveTracking (trackingPath, entries) {
  const dir = path.dirname(trackingPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(trackingPath, JSON.stringify(entries, null, 2), 'utf8')
}

/**
 * Reads and parses all CSV files from a given import directory.
 * Checks .imported.json to skip already-imported files (unless force=true).
 * @param {string} importDir - e.g. "sales/import/elasticstage"
 * @param {string} platform - "elasticstage" | "amuse" | "makewaves" | "labelcaster"
 * @param {Object} options - { force: boolean, trackingPath: string }
 * @returns {Promise<ImportRow[]>}
 */
async function importCsvFiles (importDir, platform, options = {}) {
  const { force = false, trackingPath = 'sales/import/.imported.json' } = options
  const allRows = []

  // List CSV files in the import directory
  let files
  try {
    const entries = await fs.readdir(importDir)
    files = entries.filter(f => f.toLowerCase().endsWith('.csv')).sort()
  } catch {
    // Directory doesn't exist or can't be read — no files to import
    return allRows
  }

  if (files.length === 0) return allRows

  // Load tracking data
  let tracking = await loadTracking(trackingPath)

  for (const file of files) {
    const filePath = path.join(importDir, file)

    // Compute checksum
    let checksum
    try {
      checksum = await fileChecksum(filePath)
    } catch (err) {
      console.warn(`Warning: cannot read ${filePath}: ${err.message}`)
      continue
    }

    // Check tracking (skip if already imported with same checksum, unless force)
    if (!force) {
      const existing = tracking.find(e => e.path === filePath && e.checksum === checksum)
      if (existing) continue
    }

    // Read and parse CSV
    let text
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      console.warn(`Warning: cannot read ${filePath}: ${err.message}`)
      continue
    }

    let rawRows
    try {
      rawRows = parseCsv(text)
    } catch (err) {
      console.warn(`Warning: malformed CSV ${filePath}: ${err.message}`)
      continue
    }

    if (rawRows.length < 2) {
      console.warn(`Warning: CSV file ${filePath} has no data rows, skipping`)
      continue
    }

    // Map columns
    const headers = rawRows[0]
    const { mapping, missing } = mapColumns(headers)
    if (missing.length > 0) {
      console.warn(`Warning: CSV file ${filePath} missing required columns: ${missing.join(', ')}, skipping`)
      continue
    }

    // Parse data rows
    const rows = []
    for (let r = 1; r < rawRows.length; r++) {
      const row = rawRows[r]
      // Skip empty rows
      if (row.length === 1 && row[0].trim() === '') continue

      const parsed = parseRow(row, mapping, platform)
      if (!parsed) {
        console.warn(`Warning: skipping unparseable row ${r + 1} in ${filePath}`)
        continue
      }
      rows.push(parsed)
    }

    allRows.push(...rows)

    // Update tracking entry
    const existingIdx = tracking.findIndex(e => e.path === filePath)
    const entry = {
      path: filePath,
      checksum,
      importedAt: new Date().toISOString(),
      rowCount: rows.length
    }
    if (existingIdx !== -1) {
      tracking[existingIdx] = entry
    } else {
      tracking.push(entry)
    }
  }

  // Save updated tracking
  await saveTracking(trackingPath, tracking)

  return allRows
}

module.exports = { importCsvFiles, fileChecksum, loadTracking, saveTracking }
