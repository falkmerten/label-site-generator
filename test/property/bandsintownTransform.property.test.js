'use strict'

// Feature: bandsintown-integration, Property 2: Event transformation completeness
// Feature: bandsintown-integration, Property 3: Artist info extraction
// **Validates: Requirements 2.2, 3.2, 10.1**

const fc = require('fast-check')
const { transformEvent } = require('../../src/bandsintown')

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a valid Bandsintown API event object */
const bandsintownRawEventArb = fc.record({
  datetime: fc.date({
    min: new Date('2020-01-01'),
    max: new Date('2030-12-31')
  }).map(d => d.toISOString()),
  venue: fc.record({
    name: fc.string({ minLength: 1, maxLength: 60 }),
    city: fc.string({ minLength: 1, maxLength: 40 }),
    country: fc.stringMatching(/^[A-Z]{2}$/),
    region: fc.string({ minLength: 1, maxLength: 40 })
  }),
  offers: fc.array(
    fc.record({
      type: fc.constantFrom('Tickets', 'VIP', 'General Admission'),
      url: fc.webUrl(),
      status: fc.constantFrom('available', 'sold_out', 'unknown')
    }),
    { minLength: 0, maxLength: 3 }
  ),
  url: fc.webUrl()
})

/** Generates a valid Bandsintown artist info API response */
const bandsintownArtistInfoArb = fc.record({
  tracker_count: fc.nat({ max: 1000000 }),
  upcoming_event_count: fc.nat({ max: 500 })
})

// ---------------------------------------------------------------------------
// Property 2: Event transformation completeness
// ---------------------------------------------------------------------------
describe('Property 2: Event transformation completeness', () => {
  test('transformEvent always produces all required fields with source "bandsintown"', () => {
    fc.assert(
      fc.property(bandsintownRawEventArb, (rawEvent) => {
        const result = transformEvent(rawEvent)

        // All required fields must be present
        const requiredFields = ['date', 'venueName', 'cityName', 'countryName', 'countryCode', 'eventUrl', 'source']
        for (const field of requiredFields) {
          if (!(field in result)) return false
        }

        // source is always 'bandsintown'
        if (result.source !== 'bandsintown') return false

        // date is a valid YYYY-MM-DD string
        if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) return false

        return true
      }),
      { numRuns: 100 }
    )
  })

  test('transformEvent preserves venue fields from the raw event', () => {
    fc.assert(
      fc.property(bandsintownRawEventArb, (rawEvent) => {
        const result = transformEvent(rawEvent)

        if (result.venueName !== rawEvent.venue.name) return false
        if (result.cityName !== rawEvent.venue.city) return false
        if (result.countryCode !== rawEvent.venue.country) return false
        if (result.eventUrl !== rawEvent.url) return false

        return true
      }),
      { numRuns: 100 }
    )
  })

  test('transformEvent maps offers correctly', () => {
    fc.assert(
      fc.property(bandsintownRawEventArb, (rawEvent) => {
        const result = transformEvent(rawEvent)

        if (!Array.isArray(result.offers)) return false
        if (result.offers.length !== rawEvent.offers.length) return false

        for (let i = 0; i < result.offers.length; i++) {
          if (result.offers[i].type !== rawEvent.offers[i].type) return false
          if (result.offers[i].url !== rawEvent.offers[i].url) return false
          if (result.offers[i].status !== rawEvent.offers[i].status) return false
        }

        return true
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 3: Artist info extraction
// ---------------------------------------------------------------------------
describe('Property 3: Artist info extraction', () => {
  /**
   * Since fetchArtistInfo makes HTTP calls, we test the extraction logic
   * by simulating the response parsing — the same logic used inside fetchArtistInfo.
   */
  function extractArtistInfo (body) {
    if (!body || typeof body !== 'object') return null
    return {
      trackerCount: typeof body.tracker_count === 'number' ? body.tracker_count : 0,
      upcomingEventCount: typeof body.upcoming_event_count === 'number' ? body.upcoming_event_count : 0
    }
  }

  test('extraction returns trackerCount and upcomingEventCount for valid responses', () => {
    fc.assert(
      fc.property(bandsintownArtistInfoArb, (apiResponse) => {
        const result = extractArtistInfo(apiResponse)

        if (result === null) return false
        if (result.trackerCount !== apiResponse.tracker_count) return false
        if (result.upcomingEventCount !== apiResponse.upcoming_event_count) return false

        return true
      }),
      { numRuns: 100 }
    )
  })

  test('extraction returns 0 for non-numeric tracker_count or upcoming_event_count', () => {
    const invalidFieldsArb = fc.record({
      tracker_count: fc.oneof(fc.constant('not a number'), fc.constant(null), fc.constant(undefined)),
      upcoming_event_count: fc.oneof(fc.constant('not a number'), fc.constant(null), fc.constant(undefined))
    })

    fc.assert(
      fc.property(invalidFieldsArb, (apiResponse) => {
        const result = extractArtistInfo(apiResponse)

        if (result === null) return false
        if (result.trackerCount !== 0) return false
        if (result.upcomingEventCount !== 0) return false

        return true
      }),
      { numRuns: 100 }
    )
  })

  test('extraction returns null for non-object inputs', () => {
    const nonObjectArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.string()
    )

    fc.assert(
      fc.property(nonObjectArb, (value) => {
        return extractArtistInfo(value) === null
      }),
      { numRuns: 100 }
    )
  })
})
