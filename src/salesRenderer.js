'use strict'

/**
 * Month names for period labels.
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

/**
 * Formats a number as a monetary value with exactly 2 decimal places.
 * @param {number} amount
 * @returns {string} e.g. "12.50"
 */
function formatMoney (amount) {
  return Number(amount).toFixed(2)
}

/**
 * Formats a Date (or date string) as an ISO 8601 date string.
 * @param {Date|string} date
 * @returns {string} e.g. "2025-03-15"
 */
function formatDate (date) {
  const d = date instanceof Date ? date : new Date(date)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Renders a GFM Markdown table from headers and rows.
 * Ensures consistent column counts across all rows.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
function renderTable (headers, rows) {
  const colCount = headers.length
  const pad = (row) => {
    const r = row.slice(0, colCount)
    while (r.length < colCount) r.push('')
    return r
  }
  const lines = []
  lines.push('| ' + pad(headers).join(' | ') + ' |')
  lines.push('| ' + pad(headers).map(() => '---').join(' | ') + ' |')
  for (const row of rows) {
    lines.push('| ' + pad(row).join(' | ') + ' |')
  }
  return lines.join('\n')
}


/**
 * Classifies a transaction as "digital" or "physical" based on the package field.
 * @param {{ package: string }} transaction
 * @returns {"digital"|"physical"}
 */
function classifyTransaction (transaction) {
  if (transaction.package === 'digital download') return 'digital'
  return 'physical'
}

/**
 * Maps a Bandcamp package field to a short format label.
 * Known mappings: "Compact Disc" → "CD", "Vinyl Record" → "Vinyl", "Cassette" → "Cassette".
 * Unknown non-digital values pass through unchanged.
 * @param {string} packageField
 * @returns {string}
 */
function formatLabel (packageField) {
  const map = {
    'Compact Disc': 'CD',
    'Vinyl Record': 'Vinyl',
    Cassette: 'Cassette'
  }
  return map[packageField] || packageField
}

/**
 * Returns the English month name for a zero-based month index.
 * @param {number} i - 0–11
 * @returns {string}
 */
function monthName (i) {
  return MONTH_NAMES[i]
}

/**
 * Generates an array of period objects for a given year and period type.
 * @param {number} year - Four-digit year
 * @param {string} periodType - "monthly" | "quarterly" | "half-yearly" | "annual"
 * @returns {{ start: Date, end: Date, suffix: string, label: string }[]}
 */
function getPeriods (year, periodType) {
  switch (periodType) {
    case 'monthly':
      return Array.from({ length: 12 }, (_, i) => ({
        start: new Date(Date.UTC(year, i, 1)),
        end: new Date(Date.UTC(year, i + 1, 0, 23, 59, 59)),
        suffix: `${year}-${String(i + 1).padStart(2, '0')}`,
        label: `${monthName(i)} ${year}`
      }))
    case 'quarterly':
      return [0, 3, 6, 9].map((m, i) => ({
        start: new Date(Date.UTC(year, m, 1)),
        end: new Date(Date.UTC(year, m + 3, 0, 23, 59, 59)),
        suffix: `${year}-Q${i + 1}`,
        label: `Q${i + 1} ${year}`
      }))
    case 'half-yearly':
      return [0, 6].map((m, i) => ({
        start: new Date(Date.UTC(year, m, 1)),
        end: new Date(Date.UTC(year, m + 6, 0, 23, 59, 59)),
        suffix: `${year}-H${i + 1}`,
        label: `H${i + 1} ${year}`
      }))
    default: // annual
      return [{
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
        suffix: `${year}`,
        label: `1 January ${year} — 31 December ${year}`
      }]
  }
}

/**
 * Renders a complete per-artist sales report as GFM Markdown.
 * Sections: Header, Summary, Bandcamp Sales (Physical), Bandcamp Sales (Digital),
 * ElasticStage Sales, Digital Distribution (Overview), Totals.
 * @param {object} data - ArtistReportData
 * @returns {string} GFM Markdown content
 */
function renderArtistReport (data) {
  const sections = []

  // --- Header ---
  const logoPath = data.logoPath || ''
  if (logoPath) {
    sections.push(`![Logo](${logoPath})`)
    sections.push('')
  }
  sections.push(`# Sales Report: ${data.artistName}`)
  sections.push(`**Period:** ${data.periodLabel}`)
  sections.push(`**Generated:** ${data.generatedAt}`)

  // --- Summary ---
  sections.push('\n## Summary\n')
  const currencies = Object.keys(data.totals || {})
  if (currencies.length === 0) {
    sections.push('No data for this period.')
  } else {
    for (const cur of currencies.sort()) {
      const t = data.totals[cur]
      sections.push(`**${cur}:**`)
      sections.push(`- Total Revenue: ${formatMoney(t.total)} ${cur}`)
      sections.push(`- Physical: ${formatMoney(t.physical)} ${cur}`)
      sections.push(`- Digital: ${formatMoney(t.digital)} ${cur}`)
      sections.push(`- ElasticStage: ${formatMoney(t.elasticstage)} ${cur}`)
      sections.push(`- Distributors: ${formatMoney(t.distributors)} ${cur}`)
      sections.push('')
    }
  }

  // --- Bandcamp Sales (Physical) ---
  sections.push('## Bandcamp Sales (Physical)\n')
  const physicalCurrencies = Object.keys(data.physical || {}).sort()
  if (physicalCurrencies.length === 0) {
    sections.push('No data for this period.')
  } else {
    for (const cur of physicalCurrencies) {
      const items = data.physical[cur]
      sections.push(`### ${cur}\n`)
      const rows = items.map(row => [
        formatDate(row.date),
        row.item,
        row.format,
        String(row.qty),
        `${formatMoney(row.price)} ${cur}`,
        `${formatMoney(row.shipping)} ${cur}`,
        `${formatMoney(row.bcFee || 0)} ${cur}`,
        `${formatMoney(row.txFee || row.fees || 0)} ${cur}`,
        `${formatMoney(row.net)} ${cur}`
      ])
      sections.push(renderTable(
        ['Date', 'Item', 'Format', 'Qty', 'Price', 'Shipping', 'BC Fee', 'Tx Fee', 'Net'],
        rows
      ))
      sections.push('')
    }
  }

  // --- Bandcamp Sales (Digital) ---
  sections.push('## Bandcamp Sales (Digital)\n')
  const digitalCurrencies = Object.keys(data.digital || {}).sort()
  if (digitalCurrencies.length === 0) {
    sections.push('No data for this period.')
  } else {
    for (const cur of digitalCurrencies) {
      const items = data.digital[cur]
      sections.push(`### ${cur}\n`)
      const rows = items.map(row => [
        formatDate(row.date),
        row.item,
        String(row.qty),
        `${formatMoney(row.price)} ${cur}`,
        `${formatMoney(row.bcFee || 0)} ${cur}`,
        `${formatMoney(row.txFee || row.fees || 0)} ${cur}`,
        `${formatMoney(row.net)} ${cur}`
      ])
      sections.push(renderTable(
        ['Date', 'Item', 'Qty', 'Price', 'BC Fee', 'Tx Fee', 'Net'],
        rows
      ))
      sections.push('')
    }
  }

  // --- ElasticStage Sales ---
  sections.push('## ElasticStage Sales\n')
  const esRows = data.elasticstage || []
  if (esRows.length === 0) {
    sections.push('No data for this period.')
  } else {
    const rows = esRows.map(row => [
      row.platform,
      row.artist,
      row.release,
      formatMoney(row.revenue),
      row.currency,
      String(row.quantity),
      formatDate(row.date),
      row.format
    ])
    sections.push(renderTable(
      ['Platform', 'Artist', 'Release', 'Revenue', 'Currency', 'Quantity', 'Date', 'Format'],
      rows
    ))
  }

  // --- Discogs Marketplace Sales ---
  sections.push('\n## Discogs Marketplace Sales\n')
  const discogsEntries = (data.distributors || {}).discogs || []
  if (discogsEntries.length === 0) {
    sections.push('No data for this period.')
  } else {
    const discogsRows = discogsEntries.map(entry => [
      entry.artist,
      entry.release,
      formatMoney(entry.revenue),
      entry.currency
    ])
    sections.push(renderTable(
      ['Artist', 'Release', 'Revenue', 'Currency'],
      discogsRows
    ))
    sections.push('')
    sections.push('> Amounts shown are item price minus Discogs seller fee. Artist share to be deducted.')
  }

  // --- Digital Distribution (Overview) ---
  sections.push('\n## Digital Distribution (Overview)\n')
  const digitalDistPlatforms = Object.keys(data.distributors || {}).filter(p => p !== 'discogs')
  const allDigitalDistRows = []
  for (const platform of digitalDistPlatforms.sort()) {
    const entries = data.distributors[platform]
    for (const entry of entries) {
      allDigitalDistRows.push([
        platform.charAt(0).toUpperCase() + platform.slice(1),
        entry.artist,
        entry.release,
        formatMoney(entry.revenue),
        entry.currency
      ])
    }
  }
  if (allDigitalDistRows.length === 0) {
    sections.push('No data for this period.')
  } else {
    sections.push(renderTable(
      ['Platform', 'Artist', 'Release', 'Revenue', 'Currency'],
      allDigitalDistRows
    ))
    sections.push('')
    sections.push('> Split royalties handled by distributor. Amounts shown are label share as reported.')
  }

  // --- Totals (Net) ---
  sections.push('\n## Totals (Net)\n')
  if (currencies.length === 0) {
    sections.push('No data for this period.')
  } else {
    const totalsRows = []
    for (const cur of currencies.sort()) {
      const t = data.totals[cur]
      totalsRows.push(['Physical', `${formatMoney(t.physical)} ${cur}`, cur])
      totalsRows.push(['Digital', `${formatMoney(t.digital)} ${cur}`, cur])
      totalsRows.push(['ElasticStage', `${formatMoney(t.elasticstage)} ${cur}`, cur])
      totalsRows.push(['Distributors', `${formatMoney(t.distributors)} ${cur}`, cur])
      totalsRows.push(['**Net Total**', `**${formatMoney(t.total)} ${cur}**`, cur])
    }
    sections.push(renderTable(
      ['Source', 'Amount', 'Currency'],
      totalsRows
    ))
  }

  return sections.join('\n')
}

/**
 * Renders the consolidated business report as GFM Markdown.
 * Sections: Label Summary, Revenue by Artist, Revenue by Source,
 * Revenue by Month, Top Selling Releases, Totals.
 * @param {object} data - BusinessReportData
 * @returns {string} GFM Markdown content
 */
function renderBusinessReport (data) {
  const sections = []

  // --- Header ---
  const logoPath = data.logoPath || ''
  if (logoPath) {
    sections.push(`![Logo](${logoPath})`)
    sections.push('')
  }
  sections.push(`# Business Report ${data.year}`)
  sections.push(`**Generated:** ${data.generatedAt}`)

  // --- Label Summary ---
  sections.push('\n## Label Summary\n')
  const currencies = Object.keys(data.summary || {}).sort()
  if (currencies.length === 0) {
    sections.push('No data for this period.')
  } else {
    for (const cur of currencies) {
      const s = data.summary[cur]
      sections.push(`**${cur}:**`)
      sections.push(`- Total Revenue: ${formatMoney(s.revenue)} ${cur}`)
      sections.push(`- Total Units: ${s.units}`)
      sections.push(`- Total Transactions: ${s.transactions}`)
      sections.push(`- Physical: ${formatMoney(s.physical)} ${cur}`)
      sections.push(`- Digital: ${formatMoney(s.digital)} ${cur}`)
      sections.push('')
    }
  }

  // --- Revenue by Artist (sorted by total revenue descending) ---
  sections.push('## Revenue by Artist\n')
  const artists = (data.revenueByArtist || []).slice().sort((a, b) => b.total - a.total)
  if (artists.length === 0) {
    sections.push('No data for this period.')
  } else {
    const rows = artists.map(a => [
      a.artist,
      `${formatMoney(a.physical)} ${a.currency}`,
      `${formatMoney(a.digital)} ${a.currency}`,
      `${formatMoney(a.total)} ${a.currency}`,
      a.currency
    ])
    sections.push(renderTable(
      ['Artist', 'Physical Revenue', 'Digital Revenue', 'Total Revenue', 'Currency'],
      rows
    ))
  }

  // --- Revenue by Source ---
  sections.push('\n## Revenue by Source\n')
  const sources = data.revenueBySource || []
  if (sources.length === 0) {
    sections.push('No data for this period.')
  } else {
    const rows = sources.map(s => [
      s.source,
      `${formatMoney(s.revenue)} ${s.currency}`,
      s.currency
    ])
    sections.push(renderTable(
      ['Source', 'Revenue', 'Currency'],
      rows
    ))
  }

  // --- Revenue by Month (12 rows, Jan–Dec) ---
  sections.push('\n## Revenue by Month\n')
  const months = data.revenueByMonth || []
  if (months.length === 0) {
    sections.push('No data for this period.')
  } else {
    const rows = months.map(m => [
      m.month,
      `${formatMoney(m.physical)} ${m.currency}`,
      `${formatMoney(m.digital)} ${m.currency}`,
      `${formatMoney(m.total)} ${m.currency}`,
      m.currency
    ])
    sections.push(renderTable(
      ['Month', 'Physical Revenue', 'Digital Revenue', 'Total Revenue', 'Currency'],
      rows
    ))
  }

  // --- Top Selling Releases (max 20, sorted by revenue descending) ---
  sections.push('\n## Top Selling Releases\n')
  const releases = (data.topReleases || []).slice().sort((a, b) => b.revenue - a.revenue).slice(0, 20)
  if (releases.length === 0) {
    sections.push('No data for this period.')
  } else {
    const rows = releases.map(r => [
      r.artist,
      r.release,
      String(r.units),
      `${formatMoney(r.revenue)} ${r.currency}`,
      r.currency
    ])
    sections.push(renderTable(
      ['Artist', 'Release', 'Units', 'Revenue', 'Currency'],
      rows
    ))
  }

  // --- Totals (Net) ---
  sections.push('\n## Totals (Net)\n')
  if (currencies.length === 0) {
    sections.push('No data for this period.')
  } else {
    const totalsRows = []
    for (const cur of currencies) {
      const s = data.summary[cur]
      totalsRows.push(['Physical', `${formatMoney(s.physical)} ${cur}`, cur])
      totalsRows.push(['Digital', `${formatMoney(s.digital)} ${cur}`, cur])
      totalsRows.push(['**Net Total**', `**${formatMoney(s.revenue)} ${cur}**`, cur])
    }
    sections.push(renderTable(
      ['Source', 'Amount', 'Currency'],
      totalsRows
    ))
  }

  return sections.join('\n')
}

module.exports = {
  formatMoney,
  formatDate,
  renderTable,
  classifyTransaction,
  formatLabel,
  getPeriods,
  renderArtistReport,
  renderBusinessReport
}
