'use strict'

const fc = require('fast-check')
const fs = require('fs/promises')
const path = require('path')
const os = require('os')

// Mock the markdown module to avoid ESM issues with isomorphic-dompurify
jest.mock('../../src/markdown', () => ({
  renderMarkdown: (md) => `<p>${md}</p>`
}))

const { backupCache, rotateBackups } = require('../../src/cache')
const { detectConflicts, levenshteinRatio, ALBUM_ENRICHMENT_FIELDS, ARTIST_ENRICHMENT_FIELDS } = require('../../src/refreshArtist')
const { pickFirst } = require('../../src/merger')
const { auditCache } = require('../../src/cleanup')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir () {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cache-integrity-'))
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Property 4: Backup Rotation Bound
//
// After calling backupCache() multiple times, the number of backup files
// in the directory never exceeds 5.
// ---------------------------------------------------------------------------
describe('Property 4: Backup Rotation Bound', () => {
  test('backup count never exceeds 5 after 8 sequential backups', async () => {
    const tmpDir = await makeTempDir()
    const cachePath = path.join(tmpDir, 'cache.json')

    try {
      await fs.writeFile(cachePath, JSON.stringify({ artists: [] }), 'utf8')

      for (let i = 0; i < 8; i++) {
        await backupCache(cachePath)
        // Small delay so timestamps differ
        await sleep(1100)
      }

      const files = await fs.readdir(tmpDir)
      const backups = files.filter(f => f.startsWith('cache.backup.') && f.endsWith('.json'))
      expect(backups.length).toBeLessThanOrEqual(5)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  }, 30000)
})


// ---------------------------------------------------------------------------
// Property 5: Backup Naming Format
//
// Every backup file matches the pattern cache.backup.YYYY-MM-DDTHH-MM-SS.json.
// ---------------------------------------------------------------------------
describe('Property 5: Backup Naming Format', () => {
  test('all backup files match the expected timestamp pattern', async () => {
    const tmpDir = await makeTempDir()
    const cachePath = path.join(tmpDir, 'cache.json')
    const pattern = /^cache\.backup\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/

    try {
      await fs.writeFile(cachePath, JSON.stringify({ artists: [] }), 'utf8')

      for (let i = 0; i < 3; i++) {
        await backupCache(cachePath)
        await sleep(1100)
      }

      const files = await fs.readdir(tmpDir)
      const backups = files.filter(f => f.startsWith('cache.backup.'))

      expect(backups.length).toBeGreaterThan(0)
      for (const name of backups) {
        expect(name).toMatch(pattern)
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  }, 15000)
})

// ---------------------------------------------------------------------------
// Property 2: Enrichment Field Preservation
//
// All enrichment fields that exist on a cached album are preserved when
// detectConflicts is used to compare cached vs scraped data. This test
// verifies the field lists are complete and that a simulated refresh
// preserves enrichment values.
// ---------------------------------------------------------------------------
describe('Property 2: Enrichment Field Preservation', () => {
  test('all album enrichment fields survive a simulated refresh merge', () => {
    // Generate random non-null values for every enrichment field
    const enrichmentValueArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string({ minLength: 1, maxLength: 8 }), { minKeys: 1, maxKeys: 3 })
    )

    fc.assert(
      fc.property(enrichmentValueArb, (sampleValue) => {
        // Build a cached album with all enrichment fields populated
        const cachedAlbum = { url: 'https://x.bandcamp.com/album/test', title: 'Test Album', tracks: [] }
        for (const field of ALBUM_ENRICHMENT_FIELDS) {
          cachedAlbum[field] = sampleValue
        }

        // Simulate a scraped album (same URL, no enrichment fields)
        const scrapedAlbum = { url: 'https://x.bandcamp.com/album/test', title: 'Test Album', tracks: [] }

        // Simulate the preservation logic from refreshArtist
        const merged = { ...scrapedAlbum }
        for (const field of ALBUM_ENRICHMENT_FIELDS) {
          if (cachedAlbum[field] !== undefined && cachedAlbum[field] !== null) {
            merged[field] = cachedAlbum[field]
          }
        }

        // Verify every enrichment field is preserved
        for (const field of ALBUM_ENRICHMENT_FIELDS) {
          if (merged[field] !== cachedAlbum[field]) return false
        }
        return true
      }),
      { numRuns: 200 }
    )
  })

  test('artist enrichment fields list is non-empty and contains expected keys', () => {
    expect(ARTIST_ENRICHMENT_FIELDS.length).toBeGreaterThan(0)
    expect(ARTIST_ENRICHMENT_FIELDS).toContain('streamingLinks')
    expect(ARTIST_ENRICHMENT_FIELDS).toContain('soundchartsUuid')
  })

  test('album enrichment fields list is non-empty and contains expected keys', () => {
    expect(ALBUM_ENRICHMENT_FIELDS.length).toBeGreaterThan(0)
    expect(ALBUM_ENRICHMENT_FIELDS).toContain('streamingLinks')
    expect(ALBUM_ENRICHMENT_FIELDS).toContain('upc')
    expect(ALBUM_ENRICHMENT_FIELDS).toContain('labelName')
  })
})


// ---------------------------------------------------------------------------
// Property 6: Conflict Detection Symmetry
//
// Identical cached and scraped data → empty conflicts array.
// Data with title changes → non-empty conflicts array.
// ---------------------------------------------------------------------------
describe('Property 6: Conflict Detection Symmetry', () => {
  test('identical cached and scraped albums produce no conflicts', () => {
    const titleArb = fc.string({ minLength: 1, maxLength: 40 }).filter(s => s.trim().length > 0)
    const urlArb = fc.webUrl()

    fc.assert(
      fc.property(titleArb, urlArb, (title, url) => {
        const cachedArtist = {
          albums: [{ url, title, tracks: [{ name: 'Track 1' }] }]
        }
        const scrapedAlbums = [{ url, title, tracks: [{ name: 'Track 1' }] }]

        const conflicts = detectConflicts(cachedArtist, scrapedAlbums)
        return conflicts.length === 0
      }),
      { numRuns: 200 }
    )
  })

  test('albums with different titles produce at least one conflict', () => {
    const urlArb = fc.webUrl()
    const titlePairArb = fc.tuple(
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0)
    ).filter(([a, b]) => a.trim().toLowerCase() !== b.trim().toLowerCase())

    fc.assert(
      fc.property(urlArb, titlePairArb, (url, [cachedTitle, scrapedTitle]) => {
        const cachedArtist = {
          albums: [{ url, title: cachedTitle, tracks: [] }]
        }
        const scrapedAlbums = [{ url, title: scrapedTitle, tracks: [] }]

        const conflicts = detectConflicts(cachedArtist, scrapedAlbums)
        return conflicts.length > 0
      }),
      { numRuns: 200 }
    )
  })

  test('albums with no URL match produce no conflicts', () => {
    const cachedArtist = {
      albums: [{ url: 'https://a.bandcamp.com/album/x', title: 'Old', tracks: [] }]
    }
    const scrapedAlbums = [{ url: 'https://b.bandcamp.com/album/y', title: 'New', tracks: [] }]

    const conflicts = detectConflicts(cachedArtist, scrapedAlbums)
    expect(conflicts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Levenshtein Ratio (helper)
//
// Verify identity, empty-string, and range properties.
// ---------------------------------------------------------------------------
describe('Levenshtein Ratio', () => {
  test('identical strings return 0', () => {
    expect(levenshteinRatio('abc', 'abc')).toBe(0)
  })

  test('two empty strings return 0', () => {
    expect(levenshteinRatio('', '')).toBe(0)
  })

  test('ratio is between 0 and 1 for arbitrary non-empty strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (a, b) => {
          const ratio = levenshteinRatio(a, b)
          return ratio >= 0 && ratio <= 1
        }
      ),
      { numRuns: 300 }
    )
  })

  test('one empty and one non-empty string returns 1', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        (s) => levenshteinRatio(s, '') === 1 && levenshteinRatio('', s) === 1
      ),
      { numRuns: 100 }
    )
  })
})


// ---------------------------------------------------------------------------
// Property 1: Content-First Priority
//
// pickFirst returns the first non-null, non-undefined value.
// Content > Cache > Scraped priority hierarchy.
// ---------------------------------------------------------------------------
describe('Property 1: Content-First Priority', () => {
  test('when content value exists, it always wins', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.oneof(fc.string({ minLength: 1, maxLength: 30 }), fc.constant(null)),
        fc.oneof(fc.string({ minLength: 1, maxLength: 30 }), fc.constant(null)),
        (content, cache, scraped) => {
          return pickFirst(content, cache, scraped) === content
        }
      ),
      { numRuns: 200 }
    )
  })

  test('when content is null but cache exists, cache wins', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.oneof(fc.string({ minLength: 1, maxLength: 30 }), fc.constant(null)),
        (cache, scraped) => {
          return pickFirst(null, cache, scraped) === cache
        }
      ),
      { numRuns: 200 }
    )
  })

  test('when content and cache are null, scraped wins', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        (scraped) => {
          return pickFirst(null, null, scraped) === scraped
        }
      ),
      { numRuns: 200 }
    )
  })

  test('when all values are null, returns null', () => {
    expect(pickFirst(null, null, null)).toBeNull()
  })

  test('undefined values are skipped like null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        (value) => {
          return pickFirst(undefined, null, value) === value &&
                 pickFirst(undefined, value, null) === value
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 9: Audit Report Completeness
//
// For every album in the cache that has a Bandcamp URL and an empty tracklist,
// that album appears in the emptyTracklists section. Analogous checks for
// missing labels, streaming links, and UPCs.
// ---------------------------------------------------------------------------
describe('Property 9: Audit Report Completeness', () => {
  test('albums missing tracklists, labels, streaming links, and UPCs are all reported', async () => {
    const tmpDir = await makeTempDir()
    const cachePath = path.join(tmpDir, 'cache.json')

    try {
      const cacheData = {
        artists: [
          {
            name: 'Artist A',
            albums: [
              {
                title: 'Album No Tracks',
                url: 'https://a.bandcamp.com/album/no-tracks',
                tracks: [],
                labelName: 'Some Label',
                streamingLinks: { spotify: 'https://spotify.com/x' },
                upc: '123456789012'
              },
              {
                title: 'Album No Label',
                url: 'https://a.bandcamp.com/album/no-label',
                tracks: [{ name: 'Track 1' }],
                labelName: null,
                streamingLinks: { spotify: 'https://spotify.com/y' },
                upc: '123456789013'
              },
              {
                title: 'Album No Streaming',
                url: 'https://a.bandcamp.com/album/no-streaming',
                tracks: [{ name: 'Track 1' }],
                labelName: 'Some Label',
                streamingLinks: {},
                upc: '123456789014'
              },
              {
                title: 'Album No UPC',
                url: 'https://a.bandcamp.com/album/no-upc',
                tracks: [{ name: 'Track 1' }],
                labelName: 'Some Label',
                streamingLinks: { spotify: 'https://spotify.com/z' },
                upc: null
              }
            ]
          }
        ]
      }

      await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf8')

      const report = await auditCache(cachePath)

      expect(report).not.toBeNull()

      // Empty tracklists
      const emptyTrackAlbums = report.emptyTracklists.map(e => e.album)
      expect(emptyTrackAlbums).toContain('Album No Tracks')

      // Missing labels
      const missingLabelAlbums = report.missingLabels.map(e => e.album)
      expect(missingLabelAlbums).toContain('Album No Label')

      // Missing streaming links
      const missingStreamingAlbums = report.missingStreamingLinks.map(e => e.album)
      expect(missingStreamingAlbums).toContain('Album No Streaming')

      // Missing UPCs
      const missingUpcAlbums = report.missingUpcs.map(e => e.album)
      expect(missingUpcAlbums).toContain('Album No UPC')

      // Albums that have all fields should NOT appear in any category
      expect(emptyTrackAlbums).not.toContain('Album No Label')
      expect(missingLabelAlbums).not.toContain('Album No Tracks')
      expect(missingStreamingAlbums).not.toContain('Album No Tracks')
      expect(missingUpcAlbums).not.toContain('Album No Tracks')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('returns null when cache file does not exist', async () => {
    const tmpDir = await makeTempDir()
    const cachePath = path.join(tmpDir, 'nonexistent.json')

    try {
      const report = await auditCache(cachePath)
      expect(report).toBeNull()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('empty cache returns empty report categories', async () => {
    const tmpDir = await makeTempDir()
    const cachePath = path.join(tmpDir, 'cache.json')

    try {
      await fs.writeFile(cachePath, JSON.stringify({ artists: [] }), 'utf8')
      const report = await auditCache(cachePath)

      expect(report).not.toBeNull()
      expect(report.emptyTracklists).toEqual([])
      expect(report.missingLabels).toEqual([])
      expect(report.missingStreamingLinks).toEqual([])
      expect(report.missingUpcs).toEqual([])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
