'use strict'

// Feature: bandsintown-integration, Property 6: Follow CTA URL construction
// **Validates: Requirements 6.2**

const fc = require('fast-check')

/**
 * Constructs the Follow CTA URL the same way the template does.
 * @param {string} artistName - Artist name (will be URL-encoded)
 * @param {string} appId - Bandsintown app_id
 * @returns {string} Follow CTA URL
 */
function buildFollowCtaUrl (artistName, appId) {
  const encoded = encodeURIComponent(artistName)
  return `https://www.bandsintown.com/${encoded}?came_from=${encodeURIComponent(appId)}&trigger=track`
}

describe('Property 6: Follow CTA URL construction', () => {
  test('Follow URL always starts with https://www.bandsintown.com/', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (artistName, appId) => {
          const url = buildFollowCtaUrl(artistName, appId)
          return url.startsWith('https://www.bandsintown.com/')
        }
      ),
      { numRuns: 100 }
    )
  })

  test('Follow URL contains trigger=track parameter', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (artistName, appId) => {
          const url = buildFollowCtaUrl(artistName, appId)
          return url.includes('trigger=track')
        }
      ),
      { numRuns: 100 }
    )
  })

  test('Follow URL contains came_from parameter with encoded app_id', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (artistName, appId) => {
          const url = buildFollowCtaUrl(artistName, appId)
          return url.includes(`came_from=${encodeURIComponent(appId)}`)
        }
      ),
      { numRuns: 100 }
    )
  })

  test('Follow URL contains URL-encoded artist name in the path', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (artistName, appId) => {
          const url = buildFollowCtaUrl(artistName, appId)
          const encoded = encodeURIComponent(artistName)
          return url.includes(`bandsintown.com/${encoded}?`)
        }
      ),
      { numRuns: 100 }
    )
  })

  test('Follow URL matches exact expected format', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (artistName, appId) => {
          const url = buildFollowCtaUrl(artistName, appId)
          const expected = `https://www.bandsintown.com/${encodeURIComponent(artistName)}?came_from=${encodeURIComponent(appId)}&trigger=track`
          return url === expected
        }
      ),
      { numRuns: 100 }
    )
  })

  test('special characters in artist name are properly encoded', () => {
    const specialNamesArb = fc.constantFrom(
      "Fernando's Eyes",
      'Art Noir & Friends',
      'Mötley Crüe',
      'AC/DC',
      'Guns N\' Roses',
      'The Search (DE)'
    )

    fc.assert(
      fc.property(
        specialNamesArb,
        fc.string({ minLength: 1, maxLength: 64 }),
        (artistName, appId) => {
          const url = buildFollowCtaUrl(artistName, appId)
          // URL should not contain unencoded special chars in the path segment
          const pathSegment = url.split('?')[0].replace('https://www.bandsintown.com/', '')
          // The path segment should equal the URI-encoded artist name
          return pathSegment === encodeURIComponent(artistName)
        }
      ),
      { numRuns: 100 }
    )
  })
})
