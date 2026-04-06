'use strict'

/**
 * Spotify searchAlbum Validation Tests
 *
 * Tests the scoring logic and safety guards for the Spotify search fallback.
 * Covers edge cases like short artist names ((((S)))), partial matches,
 * and false positive prevention.
 */

const fc = require('fast-check')
const { scoreSearchResult } = require('../../src/spotify')

// ---------------------------------------------------------------------------
// Helper: build a mock Spotify search result item
// ---------------------------------------------------------------------------
function mockItem (artistName, albumName, albumType) {
  return {
    name: albumName,
    album_type: albumType || 'album',
    artists: [{ name: artistName }],
    external_urls: { spotify: `https://open.spotify.com/album/mock${Math.random().toString(36).slice(2, 8)}` },
    id: 'mock' + Math.random().toString(36).slice(2, 10)
  }
}

const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// ---------------------------------------------------------------------------
// 1. Exact match (artist + album + type) → score 4
// ---------------------------------------------------------------------------
describe('Score 4: exact match (artist + album + type)', () => {
  test('Golden Apes — exact album match scores 4', () => {
    const item = mockItem('Golden Apes', 'Malvs', 'album')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs'), 'album')
    expect(score).toBe(4)
  })

  test('property: any exact match with matching type scores 4', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 30 }).filter(s => normalise(s).length >= 4),
        fc.string({ minLength: 4, maxLength: 30 }).filter(s => normalise(s).length >= 4),
        fc.constantFrom('album', 'single'),
        (artist, album, type) => {
          const item = mockItem(artist, album, type)
          return scoreSearchResult(item, normalise(artist), normalise(album), type) === 4
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ---------------------------------------------------------------------------
// 2. Artist + album match, type mismatch → score 3
// ---------------------------------------------------------------------------
describe('Score 3: artist + album match, type mismatch', () => {
  test('Golden Apes — album match but wrong type scores 3', () => {
    const item = mockItem('Golden Apes', 'Malvs', 'single')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs'), 'album')
    expect(score).toBe(3)
  })

  test('property: artist + album match with wrong type scores 3', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 30 }).filter(s => normalise(s).length >= 4),
        fc.string({ minLength: 4, maxLength: 30 }).filter(s => normalise(s).length >= 4),
        (artist, album) => {
          const item = mockItem(artist, album, 'single')
          return scoreSearchResult(item, normalise(artist), normalise(album), 'album') === 3
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ---------------------------------------------------------------------------
// 3. Artist match only (no album match) → score 0 (REJECTED)
// ---------------------------------------------------------------------------
describe('Score 0: artist-only match rejected', () => {
  test('Golden Apes — right artist, wrong album scores 0', () => {
    const item = mockItem('Golden Apes', 'Completely Different Album', 'album')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs'), 'album')
    expect(score).toBe(0)
  })

  test('property: artist match without album match always scores 0', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 20 }).filter(s => normalise(s).length >= 4),
        fc.string({ minLength: 4, maxLength: 20 }).filter(s => normalise(s).length >= 4),
        fc.string({ minLength: 4, maxLength: 20 }).filter(s => normalise(s).length >= 4),
        (artist, targetAlbum, resultAlbum) => {
          // Ensure albums are different
          if (normalise(targetAlbum) === normalise(resultAlbum)) return true // skip
          // Ensure result album doesn't contain target album prefix (would be partial match)
          if (normalise(resultAlbum).includes(normalise(targetAlbum).slice(0, 6))) return true // skip
          const item = mockItem(artist, resultAlbum, 'album')
          return scoreSearchResult(item, normalise(artist), normalise(targetAlbum), 'album') === 0
        }
      ),
      { numRuns: 300 }
    )
  })
})

// ---------------------------------------------------------------------------
// 4. (((S))) edge case — short artist name protection
// ---------------------------------------------------------------------------
describe('Short artist name protection: (((S)))', () => {
  test('(((S))) normalises to "s" (length 1) — searchAlbum would skip entirely', () => {
    const artistNorm = normalise('(((S)))')
    expect(artistNorm).toBe('s')
    expect(artistNorm.length).toBe(1)
    // searchAlbum returns null for targetArtist.length < 2
  })

  test('short artist (2-3 chars) with wrong album scores 0', () => {
    // Artist "AB" normalises to "ab" (length 2)
    const item = mockItem('AB', 'Some Random Album', 'album')
    const score = scoreSearchResult(item, 'ab', normalise('Maverick'), 'album')
    expect(score).toBe(0)
  })

  test('short artist (2-3 chars) with exact album match still scores 3+', () => {
    const item = mockItem('AB', 'Maverick', 'album')
    const score = scoreSearchResult(item, 'ab', normalise('Maverick'), 'album')
    expect(score).toBe(4)
  })

  test('short artist with partial album match scores 0 (no partial for short artists)', () => {
    // Even if album partially matches, short artists don't get score 2
    const item = mockItem('AB', 'Maverick Extended Edition', 'album')
    const score = scoreSearchResult(item, 'ab', normalise('Maverick'), 'album')
    // "maverickextendededition" does not equal "maverick", so no exact match
    // Short artist blocks partial match → score 0
    expect(score).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 5. No artist match → score 0
// ---------------------------------------------------------------------------
describe('Score 0: no artist match', () => {
  test('completely different artist scores 0', () => {
    const item = mockItem('Radiohead', 'Malvs', 'album')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs'), 'album')
    expect(score).toBe(0)
  })

  test('property: wrong artist always scores 0 regardless of album match', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 20 }).filter(s => normalise(s).length >= 4),
        fc.string({ minLength: 4, maxLength: 20 }).filter(s => normalise(s).length >= 4),
        fc.string({ minLength: 4, maxLength: 20 }).filter(s => normalise(s).length >= 4),
        (targetArtist, resultArtist, album) => {
          if (normalise(targetArtist) === normalise(resultArtist)) return true // skip
          const item = mockItem(resultArtist, album, 'album')
          return scoreSearchResult(item, normalise(targetArtist), normalise(album), null) === 0
        }
      ),
      { numRuns: 300 }
    )
  })
})

// ---------------------------------------------------------------------------
// 6. Partial album match (score 2) — only for longer artist names
// ---------------------------------------------------------------------------
describe('Score 2: partial album match', () => {
  test('long artist + partial album match with matching type scores 2', () => {
    // "Golden Apes" (10 chars normalised) searching for "malvsdeluxeedition"
    // Result album "malvsdeluxeeditionremastered" contains "malvsdeluxe" (first 12 chars)
    const item = mockItem('Golden Apes', 'Malvs Deluxe Edition Remastered', 'album')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs Deluxe Edition'), 'album')
    // targetAlbum = "malvsdeluxeedition" (18 chars, >= 6)
    // slice(0, 12) = "malvsdeluxee"
    // iAlbum = "malvsdeluxeeditionremastered" includes "malvsdeluxee" → true
    expect(score).toBe(2)
  })

  test('short target album (< 6 chars) never gets partial match', () => {
    const item = mockItem('Golden Apes', 'Malvs Extended', 'album')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs'), 'album')
    // targetAlbum = "malvs" (5 chars, < 6) → no partial match
    expect(score).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 7. Null/undefined safety
// ---------------------------------------------------------------------------
describe('Null safety', () => {
  test('item with no artists array scores 0', () => {
    const item = { name: 'Test', album_type: 'album', artists: [], external_urls: {}, id: 'x' }
    const score = scoreSearchResult(item, 'goldenapes', 'test', null)
    expect(score).toBe(0)
  })

  test('item with empty name scores 0 unless target is also empty', () => {
    const item = mockItem('Golden Apes', '', 'album')
    const score = scoreSearchResult(item, normalise('Golden Apes'), normalise('Malvs'), 'album')
    expect(score).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 8. Case insensitivity
// ---------------------------------------------------------------------------
describe('Case insensitivity', () => {
  test('mixed case artist and album still match', () => {
    const item = mockItem('GOLDEN APES', 'MALVS', 'album')
    const score = scoreSearchResult(item, normalise('golden apes'), normalise('malvs'), 'album')
    expect(score).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 9. Special characters in names
// ---------------------------------------------------------------------------
describe('Special characters', () => {
  test('Amáutica with accents matches normalised version', () => {
    const item = mockItem('Amáutica', 'El Fin del Mundo', 'album')
    const score = scoreSearchResult(item, normalise('Amáutica'), normalise('El Fin del Mundo'), 'album')
    expect(score).toBe(4)
  })

  test('parentheses and brackets stripped during normalisation', () => {
    const item = mockItem('Art of Empathy', 'End of I (Deluxe)', 'album')
    const score = scoreSearchResult(item, normalise('Art of Empathy'), normalise('End of I (Deluxe)'), 'album')
    expect(score).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 10. Score monotonicity: better matches always score higher
// ---------------------------------------------------------------------------
describe('Score monotonicity', () => {
  test('exact+type >= exact > partial > no-match', () => {
    const target = { artist: normalise('Golden Apes'), album: normalise('Malvs Deluxe Edition') }

    const exactType = scoreSearchResult(mockItem('Golden Apes', 'Malvs Deluxe Edition', 'album'), target.artist, target.album, 'album')
    const exactNoType = scoreSearchResult(mockItem('Golden Apes', 'Malvs Deluxe Edition', 'single'), target.artist, target.album, 'album')
    const noMatch = scoreSearchResult(mockItem('Radiohead', 'OK Computer', 'album'), target.artist, target.album, 'album')

    expect(exactType).toBe(4)
    expect(exactNoType).toBe(3)
    expect(noMatch).toBe(0)
    expect(exactType).toBeGreaterThan(exactNoType)
    expect(exactNoType).toBeGreaterThan(noMatch)
  })
})
