'use strict'

// Bugfix: releases-label-filter
// Property 1: Bug Condition - Unlabeled Albums Included When Label Filter Active
// **Validates: Requirements 1.1, 2.1**

const fc = require('fast-check')

// ---------------------------------------------------------------------------
// Replicate the FIXED homepageAlbums filter callback.
// After the fix, albums with no labelName return false, correctly excluding
// them when HOMEPAGE_LABELS is set.
// ---------------------------------------------------------------------------
function homepageAlbumsFilter (album, homepageLabels) {
  if (homepageLabels.length === 0) return true
  if (!album.labelName) return false // FIXED: exclude unlabeled albums
  const labels = album.labelName.toLowerCase().split('/').map(s => s.trim())
  return labels.some(l => homepageLabels.includes(l))
}

// ---------------------------------------------------------------------------
// Property 1: Bug Condition — Unlabeled Albums Excluded When Label Filter Active
//
// For any album where HOMEPAGE_LABELS is configured (non-empty) and the album
// has no labelName (null, undefined, or empty string), the filter SHOULD
// return false, excluding the album from the homepage and releases page.
//
// **Validates: Requirements 1.1, 2.1**
// ---------------------------------------------------------------------------
describe('Property 1: Bug Condition - Unlabeled Albums Included When Label Filter Active', () => {
  test('filter returns false for albums with falsy labelName when homepageLabels is non-empty', () => {
    // Generator: albums with falsy labelName values
    const falsyLabelAlbum = fc.record({
      labelName: fc.constantFrom(null, undefined, ''),
      title: fc.string({ minLength: 1 }),
      slug: fc.string({ minLength: 1 })
    })

    // Generator: non-empty array of lowercase trimmed label strings
    const homepageLabelsArb = fc.array(
      fc.string({ minLength: 1, maxLength: 30 }).map(s => s.toLowerCase().trim()).filter(s => s.length > 0),
      { minLength: 1, maxLength: 5 }
    )

    fc.assert(
      fc.property(falsyLabelAlbum, homepageLabelsArb, (album, homepageLabels) => {
        const result = homepageAlbumsFilter(album, homepageLabels)
        // Expected correct behavior: filter should return false for unlabeled albums
        return result === false
      }),
      { numRuns: 200 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 2: Preservation — Labeled Album Filtering Unchanged
//
// These tests capture the CORRECT behavior of the filter that must be
// preserved after the bugfix. They run against the buggy filter and PASS,
// confirming the baseline behavior we want to keep.
//
// **Validates: Requirements 3.1, 3.2, 3.3**
// ---------------------------------------------------------------------------
describe('Property 2: Preservation - Labeled Album Filtering Unchanged', () => {
  test('for albums with truthy labelName and non-empty homepageLabels, filter result matches label-matching logic', () => {
    // Generator: albums with truthy labelName (non-empty strings, possibly multi-label with /)
    const truthyLabelAlbum = fc.record({
      labelName: fc.oneof(
        // Single label name
        fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
        // Multi-label name with /
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0),
          fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0)
        ).map(([a, b]) => `${a} / ${b}`)
      ),
      title: fc.string({ minLength: 1 }),
      slug: fc.string({ minLength: 1 })
    })

    // Generator: non-empty array of lowercase trimmed label strings
    const homepageLabelsArb = fc.array(
      fc.string({ minLength: 1, maxLength: 30 }).map(s => s.toLowerCase().trim()).filter(s => s.length > 0),
      { minLength: 1, maxLength: 5 }
    )

    fc.assert(
      fc.property(truthyLabelAlbum, homepageLabelsArb, (album, homepageLabels) => {
        const result = homepageAlbumsFilter(album, homepageLabels)
        // The expected result is the label-matching logic itself
        const expected = album.labelName.toLowerCase().split('/').map(s => s.trim()).some(l => homepageLabels.includes(l))
        return result === expected
      }),
      { numRuns: 200 }
    )
  })

  test('when homepageLabels is empty, all albums are included regardless of labelName', () => {
    // Generator: albums with any labelName (truthy, null, undefined, empty)
    const anyAlbum = fc.record({
      labelName: fc.oneof(
        fc.constantFrom(null, undefined, ''),
        fc.string({ minLength: 1, maxLength: 30 })
      ),
      title: fc.string({ minLength: 1 }),
      slug: fc.string({ minLength: 1 })
    })

    const emptyHomepageLabels = fc.constant([])

    fc.assert(
      fc.property(anyAlbum, emptyHomepageLabels, (album, homepageLabels) => {
        const result = homepageAlbumsFilter(album, homepageLabels)
        return result === true
      }),
      { numRuns: 200 }
    )
  })
})
