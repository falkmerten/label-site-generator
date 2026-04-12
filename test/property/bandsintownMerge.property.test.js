'use strict'

// Feature: bandsintown-integration, Property 4: Three-source event merge (dedup + priority + sort)
// Feature: bandsintown-integration, Property 5: Bandsintown field preservation on merge
// **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 10.2**

// Mock the markdown module to avoid ESM issues with isomorphic-dompurify
jest.mock('../../src/markdown', () => ({
  renderMarkdown: (md) => `<p>${md}</p>`
}))

const fc = require('fast-check')
const { mergeBandsintownEvents } = require('../../src/merger')

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a YYYY-MM-DD date string */
const dateArb = fc.date({
  min: new Date('2024-01-01'),
  max: new Date('2028-12-31')
}).map(d => d.toISOString().slice(0, 10))

/** Generates a city name (non-empty, trimmed) */
const cityArb = fc.stringMatching(/^[A-Z][a-z]{2,15}$/)

/** Generates a Soundcharts event (no source field) */
const soundchartsEventArb = fc.tuple(dateArb, cityArb).chain(([date, city]) =>
  fc.record({
    date: fc.constant(date),
    venueName: fc.string({ minLength: 1, maxLength: 40 }),
    cityName: fc.constant(city),
    countryCode: fc.stringMatching(/^[A-Z]{2}$/),
    countryName: fc.string({ minLength: 1, maxLength: 30 })
  })
)

/** Generates a Bandsintown event (source: 'bandsintown') */
const bandsintownEventArb = fc.tuple(dateArb, cityArb).chain(([date, city]) =>
  fc.record({
    date: fc.constant(date),
    venueName: fc.string({ minLength: 1, maxLength: 40 }),
    cityName: fc.constant(city),
    countryCode: fc.stringMatching(/^[A-Z]{2}$/),
    countryName: fc.string({ minLength: 1, maxLength: 30 }),
    eventUrl: fc.webUrl(),
    offers: fc.array(
      fc.record({
        type: fc.constantFrom('Tickets', 'VIP'),
        url: fc.webUrl(),
        status: fc.constantFrom('available', 'sold_out')
      }),
      { minLength: 0, maxLength: 2 }
    ),
    source: fc.constant('bandsintown')
  })
)

// ---------------------------------------------------------------------------
// Property 4: Three-source event merge (dedup + priority + sort)
// ---------------------------------------------------------------------------
describe('Property 4: Three-source event merge (dedup + priority + sort)', () => {
  test('merged result is always sorted by date ascending', () => {
    fc.assert(
      fc.property(
        fc.array(soundchartsEventArb, { minLength: 0, maxLength: 8 }),
        fc.array(bandsintownEventArb, { minLength: 0, maxLength: 8 }),
        (scEvents, bitEvents) => {
          const merged = mergeBandsintownEvents(scEvents, bitEvents)

          for (let i = 1; i < merged.length; i++) {
            if ((merged[i].date || '') < (merged[i - 1].date || '')) return false
          }
          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  test('merged result contains no duplicate date+city pairs', () => {
    fc.assert(
      fc.property(
        fc.array(soundchartsEventArb, { minLength: 0, maxLength: 8 }),
        fc.array(bandsintownEventArb, { minLength: 0, maxLength: 8 }),
        (scEvents, bitEvents) => {
          const merged = mergeBandsintownEvents(scEvents, bitEvents)

          const seen = new Set()
          for (const event of merged) {
            const key = `${(event.date || '').slice(0, 10)}|${(event.cityName || '').toLowerCase().trim()}`
            if (seen.has(key)) return false
            seen.add(key)
          }
          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  test('when SC and BIT events share date+city, merged keeps SC core fields', () => {
    // Generate a shared date+city, then create one SC event and one BIT event with those
    const sharedArb = fc.tuple(dateArb, cityArb).chain(([date, city]) =>
      fc.tuple(
        fc.record({
          date: fc.constant(date),
          venueName: fc.string({ minLength: 1, maxLength: 40 }),
          cityName: fc.constant(city),
          countryCode: fc.stringMatching(/^[A-Z]{2}$/),
          countryName: fc.string({ minLength: 1, maxLength: 30 })
        }),
        fc.record({
          date: fc.constant(date),
          venueName: fc.string({ minLength: 1, maxLength: 40 }),
          cityName: fc.constant(city),
          countryCode: fc.stringMatching(/^[A-Z]{2}$/),
          countryName: fc.string({ minLength: 1, maxLength: 30 }),
          eventUrl: fc.webUrl(),
          offers: fc.constant([]),
          source: fc.constant('bandsintown')
        })
      )
    )

    fc.assert(
      fc.property(sharedArb, ([scEvent, bitEvent]) => {
        const merged = mergeBandsintownEvents([scEvent], [bitEvent])

        // Find the merged event for this date+city
        const key = `${scEvent.date}|${scEvent.cityName.toLowerCase().trim()}`
        const found = merged.find(e =>
          `${(e.date || '').slice(0, 10)}|${(e.cityName || '').toLowerCase().trim()}` === key
        )

        if (!found) return false

        // SC core fields should be preserved
        if (found.venueName !== scEvent.venueName) return false
        if (found.countryName !== scEvent.countryName) return false

        return true
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 5: Bandsintown field preservation on merge
// ---------------------------------------------------------------------------
describe('Property 5: Bandsintown field preservation on merge', () => {
  test('merged SC+BIT event preserves BIT CTA fields and sets source to "bandsintown"', () => {
    const sharedArb = fc.tuple(dateArb, cityArb).chain(([date, city]) =>
      fc.tuple(
        // Soundcharts event (no source)
        fc.record({
          date: fc.constant(date),
          venueName: fc.string({ minLength: 1, maxLength: 40 }),
          cityName: fc.constant(city),
          countryCode: fc.stringMatching(/^[A-Z]{2}$/),
          countryName: fc.string({ minLength: 1, maxLength: 30 })
        }),
        // Bandsintown event
        fc.record({
          date: fc.constant(date),
          venueName: fc.string({ minLength: 1, maxLength: 40 }),
          cityName: fc.constant(city),
          countryCode: fc.stringMatching(/^[A-Z]{2}$/),
          countryName: fc.string({ minLength: 1, maxLength: 30 }),
          eventUrl: fc.webUrl(),
          offers: fc.array(
            fc.record({
              type: fc.constantFrom('Tickets', 'VIP'),
              url: fc.webUrl(),
              status: fc.constantFrom('available', 'sold_out')
            }),
            { minLength: 1, maxLength: 3 }
          ),
          source: fc.constant('bandsintown')
        })
      )
    )

    fc.assert(
      fc.property(sharedArb, ([scEvent, bitEvent]) => {
        const merged = mergeBandsintownEvents([scEvent], [bitEvent])

        const key = `${scEvent.date}|${scEvent.cityName.toLowerCase().trim()}`
        const found = merged.find(e =>
          `${(e.date || '').slice(0, 10)}|${(e.cityName || '').toLowerCase().trim()}` === key
        )

        if (!found) return false

        // BIT CTA fields must be present
        if (found.eventUrl !== bitEvent.eventUrl) return false
        if (found.source !== 'bandsintown') return false

        // Offers from BIT should be preserved
        if (!Array.isArray(found.offers)) return false
        if (found.offers.length !== bitEvent.offers.length) return false

        // SC core fields must also be preserved
        if (found.venueName !== scEvent.venueName) return false
        if (found.countryName !== scEvent.countryName) return false

        return true
      }),
      { numRuns: 100 }
    )
  })
})
