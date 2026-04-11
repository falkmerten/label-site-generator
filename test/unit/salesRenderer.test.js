'use strict'

const { renderArtistReport, renderBusinessReport, formatMoney } = require('../../src/salesRenderer')

/**
 * Builds a minimal ArtistReportData for testing.
 */
function makeReportData (overrides = {}) {
  return {
    artistName: 'Test Artist',
    artistSlug: 'test-artist',
    year: 2025,
    periodLabel: '1 January 2025 — 31 December 2025',
    periodSuffix: '2025',
    generatedAt: '2025-06-15',
    physical: {},
    digital: {},
    elasticstage: [],
    distributors: {},
    totals: {},
    ...overrides
  }
}

describe('renderArtistReport', () => {
  test('contains all required sections in order', () => {
    const md = renderArtistReport(makeReportData())
    const headings = md.match(/^#{1,3} .+/gm).map(h => h.replace(/^#+\s*/, ''))
    expect(headings).toEqual([
      'Sales Report: Test Artist',
      'Summary',
      'Bandcamp Sales (Physical)',
      'Bandcamp Sales (Digital)',
      'ElasticStage Sales',
      'Discogs Marketplace Sales',
      'Digital Distribution (Overview)',
      'Totals (Net)'
    ])
  })

  test('shows header with artist name, period, and generated date', () => {
    const md = renderArtistReport(makeReportData())
    expect(md).toContain('# Sales Report: Test Artist')
    expect(md).toContain('**Period:** 1 January 2025 — 31 December 2025')
    expect(md).toContain('**Generated:** 2025-06-15')
  })

  test('shows "No data for this period." for all empty sections', () => {
    const md = renderArtistReport(makeReportData())
    const noDataCount = (md.match(/No data for this period\./g) || []).length
    // Summary, Physical, Digital, ElasticStage, Discogs, Digital Distribution, Totals = 7 empty sections
    expect(noDataCount).toBe(7)
  })

  test('renders physical sales table grouped by currency', () => {
    const data = makeReportData({
      physical: {
        EUR: [
          { date: '2025-03-15', item: 'Album A', format: 'CD', qty: 2, price: 12.00, shipping: 3.50, fees: 1.20, net: 10.30 }
        ],
        USD: [
          { date: '2025-04-01', item: 'Album B', format: 'Vinyl', qty: 1, price: 25.00, shipping: 5.00, fees: 2.50, net: 17.50 }
        ]
      },
      totals: {
        EUR: { physical: 10.30, digital: 0, elasticstage: 0, distributors: 0, total: 10.30 },
        USD: { physical: 17.50, digital: 0, elasticstage: 0, distributors: 0, total: 17.50 }
      }
    })
    const md = renderArtistReport(data)
    // Physical section has EUR and USD subheadings
    expect(md).toContain('### EUR')
    expect(md).toContain('### USD')
    // Table headers
    expect(md).toContain('| Date | Item | Format | Qty | Price | Shipping | BC Fee | Tx Fee | Net |')
    // Currency codes next to amounts
    expect(md).toContain('12.00 EUR')
    expect(md).toContain('10.30 EUR')
    expect(md).toContain('25.00 USD')
    expect(md).toContain('17.50 USD')
  })

  test('renders digital sales table grouped by currency', () => {
    const data = makeReportData({
      digital: {
        EUR: [
          { date: '2025-02-10', item: 'Single X', qty: 5, price: 1.00, fees: 0.50, net: 4.50 }
        ]
      },
      totals: {
        EUR: { physical: 0, digital: 4.50, elasticstage: 0, distributors: 0, total: 4.50 }
      }
    })
    const md = renderArtistReport(data)
    expect(md).toContain('| Date | Item | Qty | Price | BC Fee | Tx Fee | Net |')
    expect(md).toContain('1.00 EUR')
    expect(md).toContain('4.50 EUR')
  })

  test('renders refunds as negative line items', () => {
    const data = makeReportData({
      physical: {
        EUR: [
          { date: '2025-05-01', item: 'Album A', format: 'CD', qty: -1, price: 12.00, shipping: 0, fees: -1.20, net: -10.80 }
        ]
      },
      totals: {
        EUR: { physical: -10.80, digital: 0, elasticstage: 0, distributors: 0, total: -10.80 }
      }
    })
    const md = renderArtistReport(data)
    expect(md).toContain('-1')
    expect(md).toContain('-10.80 EUR')
  })

  test('renders ElasticStage sales table', () => {
    const data = makeReportData({
      elasticstage: [
        { platform: 'elasticstage', artist: 'Test Artist', release: 'Album C', revenue: 30.00, currency: 'EUR', quantity: 10, date: '2025-06-01', format: 'physical' }
      ],
      totals: {
        EUR: { physical: 0, digital: 0, elasticstage: 30.00, distributors: 0, total: 30.00 }
      }
    })
    const md = renderArtistReport(data)
    expect(md).toContain('| Platform | Artist | Release | Revenue | Currency | Quantity | Date | Format |')
    expect(md).toContain('| 30.00 | EUR |')
  })

  test('renders Digital Distribution overview with distributor note', () => {
    const data = makeReportData({
      distributors: {
        amuse: [
          { artist: 'Test Artist', release: 'Album D', revenue: 20.00, currency: 'EUR' }
        ]
      },
      totals: {
        EUR: { physical: 0, digital: 0, elasticstage: 0, distributors: 20.00, total: 20.00 }
      }
    })
    const md = renderArtistReport(data)
    expect(md).toContain('| Platform | Artist | Release | Revenue | Currency |')
    expect(md).toContain('Amuse')
    expect(md).toContain('| 20.00 | EUR |')
    expect(md).toContain('Split royalties handled by distributor. Amounts shown are label share as reported.')
  })

  test('renders Totals section with per-currency breakdown', () => {
    const data = makeReportData({
      totals: {
        EUR: { physical: 100.00, digital: 50.00, elasticstage: 30.00, distributors: 20.00, total: 200.00 },
        USD: { physical: 40.00, digital: 10.00, elasticstage: 0, distributors: 0, total: 50.00 }
      }
    })
    const md = renderArtistReport(data)
    // Totals table
    expect(md).toContain('| Source | Amount | Currency |')
    expect(md).toContain('200.00 EUR')
    expect(md).toContain('50.00 USD')
    expect(md).toContain('**Net Total**')
  })

  test('distributor platform names are capitalized', () => {
    const data = makeReportData({
      distributors: {
        makewaves: [{ artist: 'A', release: 'R', revenue: 5, currency: 'EUR' }],
        labelcaster: [{ artist: 'B', release: 'S', revenue: 3, currency: 'EUR' }]
      },
      totals: { EUR: { physical: 0, digital: 0, elasticstage: 0, distributors: 8, total: 8 } }
    })
    const md = renderArtistReport(data)
    expect(md).toContain('Makewaves')
    expect(md).toContain('Labelcaster')
  })
})


/**
 * Builds a minimal BusinessReportData for testing.
 */
function makeBusinessData (overrides = {}) {
  return {
    year: 2025,
    generatedAt: '2025-06-15',
    summary: {},
    revenueByArtist: [],
    revenueBySource: [],
    revenueByMonth: [],
    topReleases: [],
    ...overrides
  }
}

describe('renderBusinessReport', () => {
  test('contains all required sections in order', () => {
    const md = renderBusinessReport(makeBusinessData())
    const headings = md.match(/^#{1,2} .+/gm).map(h => h.replace(/^#+\s*/, ''))
    expect(headings).toEqual([
      'Business Report 2025',
      'Label Summary',
      'Revenue by Artist',
      'Revenue by Source',
      'Revenue by Month',
      'Top Selling Releases',
      'Totals (Net)'
    ])
  })

  test('shows header with year and generated date', () => {
    const md = renderBusinessReport(makeBusinessData())
    expect(md).toContain('# Business Report 2025')
    expect(md).toContain('**Generated:** 2025-06-15')
  })

  test('shows "No data for this period." for all empty sections', () => {
    const md = renderBusinessReport(makeBusinessData())
    const noDataCount = (md.match(/No data for this period\./g) || []).length
    // Label Summary, Revenue by Artist, Revenue by Source, Revenue by Month, Top Selling Releases, Totals = 6
    expect(noDataCount).toBe(6)
  })

  test('renders Label Summary with revenue, units, transactions, physical/digital breakdown', () => {
    const data = makeBusinessData({
      summary: {
        EUR: { revenue: 5000.00, units: 320, transactions: 280, physical: 2000.00, digital: 3000.00 }
      }
    })
    const md = renderBusinessReport(data)
    expect(md).toContain('Total Revenue: 5000.00 EUR')
    expect(md).toContain('Total Units: 320')
    expect(md).toContain('Total Transactions: 280')
    expect(md).toContain('Physical: 2000.00 EUR')
    expect(md).toContain('Digital: 3000.00 EUR')
  })

  test('renders Revenue by Artist table sorted by total revenue descending', () => {
    const data = makeBusinessData({
      revenueByArtist: [
        { artist: 'Low', physical: 100, digital: 50, total: 150, currency: 'EUR' },
        { artist: 'High', physical: 1000, digital: 500, total: 1500, currency: 'EUR' },
        { artist: 'Mid', physical: 400, digital: 200, total: 600, currency: 'EUR' }
      ]
    })
    const md = renderBusinessReport(data)
    expect(md).toContain('| Artist | Physical Revenue | Digital Revenue | Total Revenue | Currency |')
    // Verify order: High before Mid before Low
    const highIdx = md.indexOf('High')
    const midIdx = md.indexOf('Mid')
    const lowIdx = md.indexOf('Low')
    expect(highIdx).toBeLessThan(midIdx)
    expect(midIdx).toBeLessThan(lowIdx)
  })

  test('renders Revenue by Source table', () => {
    const data = makeBusinessData({
      revenueBySource: [
        { source: 'Bandcamp Physical', revenue: 2000, currency: 'EUR' },
        { source: 'Bandcamp Digital', revenue: 1500, currency: 'EUR' }
      ]
    })
    const md = renderBusinessReport(data)
    expect(md).toContain('| Source | Revenue | Currency |')
    expect(md).toContain('Bandcamp Physical')
    expect(md).toContain('2000.00 EUR')
    expect(md).toContain('1500.00 EUR')
  })

  test('renders Revenue by Month table with 12 rows', () => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ]
    const data = makeBusinessData({
      revenueByMonth: months.map(m => ({
        month: m, physical: 100, digital: 200, total: 300, currency: 'EUR'
      }))
    })
    const md = renderBusinessReport(data)
    expect(md).toContain('| Month | Physical Revenue | Digital Revenue | Total Revenue | Currency |')
    for (const m of months) {
      expect(md).toContain(m)
    }
    // Count data rows in the Revenue by Month table (12 month rows)
    const monthTableMatch = md.split('## Revenue by Month')[1].split('## Top Selling Releases')[0]
    const allRows = monthTableMatch.match(/^\|.+\|$/gm)
    const dataRows = allRows.slice(2)
    expect(dataRows).toHaveLength(12)
  })

  test('renders Top Selling Releases capped at 20 and sorted by revenue descending', () => {
    const releases = Array.from({ length: 25 }, (_, i) => ({
      artist: `Artist ${i}`,
      release: `Release ${i}`,
      units: 10 + i,
      revenue: 100 + i * 10,
      currency: 'EUR'
    }))
    const data = makeBusinessData({ topReleases: releases })
    const md = renderBusinessReport(data)
    expect(md).toContain('| Artist | Release | Units | Revenue | Currency |')
    // Count data rows in Top Selling Releases table (exclude header and separator)
    const releasesSection = md.split('## Top Selling Releases')[1].split('## Totals')[0]
    const allRows = releasesSection.match(/^\|.+\|$/gm)
    // allRows includes header + separator + data rows
    const dataRows = allRows.slice(2)
    expect(dataRows).toHaveLength(20)
    // First entry should be the highest revenue (Artist 24, revenue 340)
    expect(dataRows[0]).toContain('Artist 24')
  })

  test('renders Totals section with net totals per currency', () => {
    const data = makeBusinessData({
      summary: {
        EUR: { revenue: 5000.00, units: 320, transactions: 280, physical: 2000.00, digital: 3000.00 },
        USD: { revenue: 1000.00, units: 50, transactions: 40, physical: 400.00, digital: 600.00 }
      }
    })
    const md = renderBusinessReport(data)
    const totalsSection = md.split('## Totals')[1]
    expect(totalsSection).toContain('| Source | Amount | Currency |')
    expect(totalsSection).toContain('Physical')
    expect(totalsSection).toContain('Digital')
    expect(totalsSection).toContain('**Net Total**')
    expect(totalsSection).toContain('5000.00 EUR')
    expect(totalsSection).toContain('1000.00 USD')
  })

  test('multi-currency Label Summary shows all currencies', () => {
    const data = makeBusinessData({
      summary: {
        EUR: { revenue: 5000, units: 320, transactions: 280, physical: 2000, digital: 3000 },
        USD: { revenue: 1000, units: 50, transactions: 40, physical: 400, digital: 600 }
      }
    })
    const md = renderBusinessReport(data)
    expect(md).toContain('**EUR:**')
    expect(md).toContain('**USD:**')
    expect(md).toContain('5000.00 EUR')
    expect(md).toContain('1000.00 USD')
  })
})
