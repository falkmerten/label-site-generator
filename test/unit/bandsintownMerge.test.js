'use strict'

// Mock the markdown module to avoid ESM issues with isomorphic-dompurify
jest.mock('../../src/markdown', () => ({
  renderMarkdown: (md) => '<p>' + md + '</p>'
}))

const { mergeBandsintownEvents } = require('../../src/merger')

// ---------------------------------------------------------------------------
// Helpers — event factories
// ---------------------------------------------------------------------------

function scEvent (date, city, overrides = {}) {
  return {
    date,
    venueName: overrides.venueName || 'SC Venue',
    cityName: city,
    countryCode: overrides.countryCode || 'DE',
    countryName: overrides.countryName || 'Germany',
    ...overrides
  }
}

function bitEvent (date, city, overrides = {}) {
  return {
    date,
    venueName: overrides.venueName || 'BIT Venue',
    cityName: city,
    countryCode: overrides.countryCode || 'DE',
    countryName: overrides.countryName || 'Germany',
    eventUrl: overrides.eventUrl || 'https://www.bandsintown.com/e/123',
    offers: overrides.offers || [{ type: 'Tickets', url: 'https://tix.com', status: 'available' }],
    source: 'bandsintown',
    ...overrides
  }
}

function tourdateEvent (date, city, overrides = {}) {
  // tourdates.json events have no source field, similar to SC events
  return {
    date,
    venueName: overrides.venueName || 'Manual Venue',
    cityName: city,
    countryCode: overrides.countryCode || 'US',
    countryName: overrides.countryName || 'United States',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// SC-only: existing events from Soundcharts, no BIT events
// ---------------------------------------------------------------------------
describe('SC-only: Soundcharts events, no BIT events', () => {
  test('returns existing SC events sorted by date', () => {
    const existing = [
      scEvent('2026-06-15', 'Berlin'),
      scEvent('2026-04-01', 'Munich'),
      scEvent('2026-05-10', 'Hamburg')
    ]

    const result = mergeBandsintownEvents(existing, [])

    expect(result).toHaveLength(3)
    expect(result[0].date).toBe('2026-04-01')
    expect(result[1].date).toBe('2026-05-10')
    expect(result[2].date).toBe('2026-06-15')
  })
})

// ---------------------------------------------------------------------------
// BIT-only: no existing events, BIT events provided
// ---------------------------------------------------------------------------
describe('BIT-only: no existing events, BIT events provided', () => {
  test('returns BIT events sorted by date', () => {
    const bit = [
      bitEvent('2026-09-20', 'Stockholm'),
      bitEvent('2026-07-05', 'Copenhagen'),
      bitEvent('2026-08-12', 'Oslo')
    ]

    const result = mergeBandsintownEvents([], bit)

    expect(result).toHaveLength(3)
    expect(result[0].date).toBe('2026-07-05')
    expect(result[1].date).toBe('2026-08-12')
    expect(result[2].date).toBe('2026-09-20')
    // All should retain bandsintown source
    result.forEach(e => expect(e.source).toBe('bandsintown'))
  })
})

// ---------------------------------------------------------------------------
// tourdates-only: existing events from tourdates.json, no BIT events
// ---------------------------------------------------------------------------
describe('tourdates-only: manual fallback events, no BIT events', () => {
  test('returns existing tourdate events sorted (no source field)', () => {
    const existing = [
      tourdateEvent('2026-11-01', 'New York'),
      tourdateEvent('2026-10-15', 'Los Angeles')
    ]

    const result = mergeBandsintownEvents(existing, [])

    expect(result).toHaveLength(2)
    expect(result[0].date).toBe('2026-10-15')
    expect(result[1].date).toBe('2026-11-01')
    // No source field on tourdate events
    result.forEach(e => expect(e.source).toBeUndefined())
  })
})

// ---------------------------------------------------------------------------
// All three combined: SC + BIT + tourdates with overlapping date+city
// ---------------------------------------------------------------------------
describe('All three combined: SC + BIT + tourdates', () => {
  test('deduplicates by date+city, preserves SC core fields, grafts BIT CTA fields', () => {
    const existing = [
      // SC event for Berlin on June 15
      scEvent('2026-06-15', 'Berlin', { venueName: 'SC Berlin Venue', countryName: 'Germany' }),
      // tourdate event for Munich on July 1
      tourdateEvent('2026-07-01', 'Munich', { venueName: 'Manual Munich Venue' })
    ]

    const bit = [
      // BIT event for Berlin on June 15 (overlaps with SC)
      bitEvent('2026-06-15', 'Berlin', {
        venueName: 'BIT Berlin Venue',
        eventUrl: 'https://bit.ly/berlin',
        offers: [{ type: 'Tickets', url: 'https://tix.com/berlin', status: 'available' }]
      }),
      // BIT event for Munich on July 1 (overlaps with tourdate)
      bitEvent('2026-07-01', 'Munich', {
        venueName: 'BIT Munich Venue',
        eventUrl: 'https://bit.ly/munich',
        offers: [{ type: 'Tickets', url: 'https://tix.com/munich', status: 'sold_out' }]
      }),
      // BIT-only event for Stockholm on Aug 20
      bitEvent('2026-08-20', 'Stockholm', { eventUrl: 'https://bit.ly/stockholm' })
    ]

    const result = mergeBandsintownEvents(existing, bit)

    // Should have 3 events (Berlin deduped, Munich deduped, Stockholm new)
    expect(result).toHaveLength(3)

    // Sorted by date
    expect(result[0].date).toBe('2026-06-15')
    expect(result[1].date).toBe('2026-07-01')
    expect(result[2].date).toBe('2026-08-20')

    // Berlin: SC core fields preserved, BIT CTA fields grafted
    const berlin = result[0]
    expect(berlin.venueName).toBe('SC Berlin Venue') // SC wins
    expect(berlin.eventUrl).toBe('https://bit.ly/berlin') // BIT grafted
    expect(berlin.source).toBe('bandsintown') // BIT grafted

    // Munich: tourdate core fields preserved, BIT CTA fields grafted
    const munich = result[1]
    expect(munich.venueName).toBe('Manual Munich Venue') // existing wins
    expect(munich.eventUrl).toBe('https://bit.ly/munich') // BIT grafted
    expect(munich.source).toBe('bandsintown')

    // Stockholm: BIT-only, all fields from BIT
    const stockholm = result[2]
    expect(stockholm.source).toBe('bandsintown')
    expect(stockholm.eventUrl).toBe('https://bit.ly/stockholm')
  })
})

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------
describe('Empty inputs', () => {
  test('both arrays empty returns empty array', () => {
    const result = mergeBandsintownEvents([], [])
    expect(result).toEqual([])
  })

  test('null existingEvents returns BIT events', () => {
    const bit = [bitEvent('2026-05-01', 'Paris')]
    const result = mergeBandsintownEvents(null, bit)
    expect(result).toHaveLength(1)
    expect(result[0].cityName).toBe('Paris')
  })

  test('undefined existingEvents returns BIT events', () => {
    const bit = [bitEvent('2026-05-01', 'Rome')]
    const result = mergeBandsintownEvents(undefined, bit)
    expect(result).toHaveLength(1)
  })

  test('null bandsintownEvents returns existing events', () => {
    const existing = [scEvent('2026-05-01', 'London')]
    const result = mergeBandsintownEvents(existing, null)
    expect(result).toHaveLength(1)
    expect(result[0].cityName).toBe('London')
  })

  test('undefined bandsintownEvents returns existing events', () => {
    const existing = [scEvent('2026-05-01', 'Madrid')]
    const result = mergeBandsintownEvents(existing, undefined)
    expect(result).toHaveLength(1)
  })

  test('both null returns empty array', () => {
    const result = mergeBandsintownEvents(null, null)
    expect(result).toEqual([])
  })

  test('both undefined returns empty array', () => {
    const result = mergeBandsintownEvents(undefined, undefined)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Field grafting: SC event + BIT event same date+city
// ---------------------------------------------------------------------------
describe('Field grafting: SC + BIT same date+city', () => {
  test('merged event has SC venueName + BIT eventUrl/offers/source', () => {
    const sc = scEvent('2026-09-01', 'Vienna', {
      venueName: 'Arena Wien',
      countryName: 'Austria',
      countryCode: 'AT'
    })

    const bit = bitEvent('2026-09-01', 'Vienna', {
      venueName: 'BIT Arena',
      eventUrl: 'https://www.bandsintown.com/e/456',
      offers: [
        { type: 'Tickets', url: 'https://tix.com/vienna', status: 'available' },
        { type: 'VIP', url: 'https://tix.com/vienna-vip', status: 'sold_out' }
      ]
    })

    const result = mergeBandsintownEvents([sc], [bit])

    expect(result).toHaveLength(1)
    const merged = result[0]

    // SC core fields
    expect(merged.venueName).toBe('Arena Wien')
    expect(merged.countryName).toBe('Austria')
    expect(merged.countryCode).toBe('AT')

    // BIT CTA fields
    expect(merged.eventUrl).toBe('https://www.bandsintown.com/e/456')
    expect(merged.source).toBe('bandsintown')
    expect(merged.offers).toHaveLength(2)
    expect(merged.offers[0].status).toBe('available')
    expect(merged.offers[1].status).toBe('sold_out')
  })

  test('city matching is case-insensitive', () => {
    const sc = scEvent('2026-10-01', 'BERLIN', { venueName: 'SC Club' })
    const bit = bitEvent('2026-10-01', 'berlin', { eventUrl: 'https://bit.ly/b' })

    const result = mergeBandsintownEvents([sc], [bit])

    // Should dedup — same date, same city (case-insensitive)
    expect(result).toHaveLength(1)
    expect(result[0].venueName).toBe('SC Club')
    expect(result[0].eventUrl).toBe('https://bit.ly/b')
  })
})
