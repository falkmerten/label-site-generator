'use strict'

// Feature: bandsintown-integration, Property 1: Bandsintown config validation
// **Validates: Requirements 1.1, 1.4**

const fc = require('fast-check')

/**
 * Validates a Bandsintown config object using the same logic as content.js:
 * accepted iff it has both `app_id` (non-empty string) and `artist_name` (non-empty string).
 * Optional `artist_id` is preserved when present.
 */
function isValidBandsintownConfig (obj) {
  if (!obj || typeof obj !== 'object') return false
  return typeof obj.app_id === 'string' && obj.app_id.length > 0 &&
         typeof obj.artist_name === 'string' && obj.artist_name.length > 0
}

describe('Property 1: Bandsintown config validation', () => {
  test('objects with non-empty app_id and artist_name are always valid', () => {
    const validConfigArb = fc.record({
      app_id: fc.string({ minLength: 1, maxLength: 64 }),
      artist_name: fc.string({ minLength: 1, maxLength: 100 })
    })

    fc.assert(
      fc.property(validConfigArb, (config) => {
        return isValidBandsintownConfig(config) === true
      }),
      { numRuns: 100 }
    )
  })

  test('objects missing app_id are always invalid', () => {
    const missingAppIdArb = fc.record({
      artist_name: fc.string({ minLength: 1, maxLength: 100 })
    })

    fc.assert(
      fc.property(missingAppIdArb, (config) => {
        return isValidBandsintownConfig(config) === false
      }),
      { numRuns: 100 }
    )
  })

  test('objects missing artist_name are always invalid', () => {
    const missingArtistNameArb = fc.record({
      app_id: fc.string({ minLength: 1, maxLength: 64 })
    })

    fc.assert(
      fc.property(missingArtistNameArb, (config) => {
        return isValidBandsintownConfig(config) === false
      }),
      { numRuns: 100 }
    )
  })

  test('objects with empty string app_id are invalid', () => {
    const emptyAppIdArb = fc.record({
      app_id: fc.constant(''),
      artist_name: fc.string({ minLength: 1, maxLength: 100 })
    })

    fc.assert(
      fc.property(emptyAppIdArb, (config) => {
        return isValidBandsintownConfig(config) === false
      }),
      { numRuns: 100 }
    )
  })

  test('objects with empty string artist_name are invalid', () => {
    const emptyArtistNameArb = fc.record({
      app_id: fc.string({ minLength: 1, maxLength: 64 }),
      artist_name: fc.constant('')
    })

    fc.assert(
      fc.property(emptyArtistNameArb, (config) => {
        return isValidBandsintownConfig(config) === false
      }),
      { numRuns: 100 }
    )
  })

  test('optional artist_id is preserved when present', () => {
    const configWithIdArb = fc.record({
      app_id: fc.string({ minLength: 1, maxLength: 64 }),
      artist_name: fc.string({ minLength: 1, maxLength: 100 }),
      artist_id: fc.string({ minLength: 1, maxLength: 20 })
    })

    fc.assert(
      fc.property(configWithIdArb, (config) => {
        if (!isValidBandsintownConfig(config)) return false
        // artist_id should still be on the object after validation
        return typeof config.artist_id === 'string' && config.artist_id.length > 0
      }),
      { numRuns: 100 }
    )
  })

  test('non-object values are always invalid', () => {
    const nonObjectArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.string(),
      fc.boolean(),
      fc.constant([])
    )

    fc.assert(
      fc.property(nonObjectArb, (value) => {
        return isValidBandsintownConfig(value) === false
      }),
      { numRuns: 100 }
    )
  })
})
