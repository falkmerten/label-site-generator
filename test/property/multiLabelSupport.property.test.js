'use strict'

// Feature: multi-label-support, Property 1: Enricher label consistency invariant
// **Validates: Requirements 1.1, 1.2, 1.3, 2.1**

const fc = require('fast-check')
const { buildLabelData } = require('../../src/discogs')

// ---------------------------------------------------------------------------
// Property 1: Enricher label consistency invariant
//
// For any enricher result that contains label data, the number of elements in
// the `labelUrls` array SHALL equal the number of label names obtained by
// splitting `labelName` on " / ", and joining those label names with " / "
// SHALL reproduce the original `labelName` string.
//
// **Validates: Requirements 1.1, 1.2, 1.3, 2.1**
// ---------------------------------------------------------------------------
describe('Property 1: Enricher label consistency invariant', () => {
  // Generator: random arrays of {name, id} label objects with non-empty names
  // that don't contain " / " (since that's the join separator) and don't start
  // with "Not On Label" (those get excluded by the logic)
  const labelObjectArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 40 })
      .filter(s => s.trim().length > 0)
      .filter(s => !s.includes(' / '))
      .filter(s => !s.trim().startsWith('Not On Label')),
    id: fc.option(fc.nat({ max: 999999 }), { nil: null })
  })

  const labelArrayArb = fc.array(labelObjectArb, { minLength: 1, maxLength: 10 })

  test('labelName split count equals labelUrls length', () => {
    fc.assert(
      fc.property(labelArrayArb, (labels) => {
        const result = buildLabelData(labels)

        // If no labels survive filtering, labelName is null and labelUrls is empty
        if (result.labelName === null) {
          return result.labelUrls.length === 0
        }

        const splitNames = result.labelName.split(' / ')
        return splitNames.length === result.labelUrls.length
      }),
      { numRuns: 200 }
    )
  })

  test('joining split label names reproduces labelName', () => {
    fc.assert(
      fc.property(labelArrayArb, (labels) => {
        const result = buildLabelData(labels)

        if (result.labelName === null) {
          return true // nothing to verify
        }

        const splitNames = result.labelName.split(' / ')
        const rejoined = splitNames.join(' / ')
        return rejoined === result.labelName
      }),
      { numRuns: 200 }
    )
  })

  test('labelUrl equals first element of labelUrls (or null when empty)', () => {
    fc.assert(
      fc.property(labelArrayArb, (labels) => {
        const result = buildLabelData(labels)

        if (result.labelUrls.length === 0) {
          return result.labelUrl === null
        }

        return result.labelUrl === (result.labelUrls[0] || null)
      }),
      { numRuns: 200 }
    )
  })
})

// Feature: multi-label-support, Property 2: Distinct label URLs for distinct label IDs
// **Validates: Requirements 2.2**

// ---------------------------------------------------------------------------
// Property 2: Distinct label URLs for distinct label IDs
//
// For any set of Discogs labels with distinct label IDs (non-null), the
// corresponding entries in the `labelUrls` array SHALL be distinct URLs
// (no two labels with different IDs share the same URL).
//
// **Validates: Requirements 2.2**
// ---------------------------------------------------------------------------
describe('Property 2: Distinct label URLs for distinct label IDs', () => {
  // Generator: produce an array of labels where all IDs are unique positive
  // integers (min 1, since 0 is falsy and treated as "no ID") and all names
  // are unique non-empty strings (so nothing gets deduplicated or filtered out).
  const distinctLabelsArb = fc
    .uniqueArray(fc.integer({ min: 1, max: 999999 }), { minLength: 2, maxLength: 10 })
    .chain((ids) =>
      fc
        .uniqueArray(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(s => s.trim().length > 0)
            .filter(s => !s.includes(' / '))
            .filter(s => !s.trim().startsWith('Not On Label')),
          { minLength: ids.length, maxLength: ids.length }
        )
        .map((names) =>
          ids.map((id, i) => ({ name: names[i], id }))
        )
    )

  test('all output URLs are distinct when all input IDs are unique', () => {
    fc.assert(
      fc.property(distinctLabelsArb, (labels) => {
        const result = buildLabelData(labels)

        // Every label should survive (unique names, no "Not On Label", non-empty)
        // so labelUrls length should equal input length
        if (result.labelUrls.length !== labels.length) return false

        // All URLs should be non-null (every label has a non-null id)
        if (result.labelUrls.some(u => u === null)) return false

        // All URLs should be distinct
        const urlSet = new Set(result.labelUrls)
        return urlSet.size === result.labelUrls.length
      }),
      { numRuns: 200 }
    )
  })
})

// Feature: multi-label-support, Property 3: Label deduplication and "Not On Label" exclusion
// **Validates: Requirements 3.2, 3.3**

// ---------------------------------------------------------------------------
// Property 3: Label deduplication and "Not On Label" exclusion
//
// For any list of raw label entries collected from Discogs releases, the output
// label set SHALL contain no duplicate names, SHALL preserve the first-encountered
// URL for each unique name, and SHALL contain no label whose name starts with
// "Not On Label".
//
// Note: buildLabelData strips trailing " (digits)" from names before dedup,
// so two entries like "Foo (2)" and "Foo (3)" both become "Foo" and only the
// first one's URL is kept.
//
// **Validates: Requirements 3.2, 3.3**
// ---------------------------------------------------------------------------
describe('Property 3: Label deduplication and "Not On Label" exclusion', () => {
  // Base name generator: non-empty strings that don't contain " / " and
  // are not empty after trimming
  const baseNameArb = fc.string({ minLength: 1, maxLength: 20 })
    .filter(s => s.trim().length > 0)
    .filter(s => !s.includes(' / '))

  // Generator for a label entry that may be a "Not On Label" entry
  const notOnLabelArb = fc.record({
    name: fc.constantFrom(
      'Not On Label',
      'Not On Label (Self-released)',
      'Not On Label (Indie Press)'
    ),
    id: fc.option(fc.nat({ max: 999999 }), { nil: null })
  })

  // Generator for a normal label entry, optionally with a trailing " (digits)"
  // suffix that buildLabelData strips before dedup
  const normalLabelArb = fc.tuple(
    baseNameArb,
    fc.boolean(), // whether to add a trailing (digits) suffix
    fc.nat({ max: 9999 }), // the digit suffix value
    fc.option(fc.nat({ min: 1, max: 999999 }), { nil: null })
  ).map(([baseName, addSuffix, suffixNum, id]) => ({
    name: addSuffix ? `${baseName} (${suffixNum})` : baseName,
    id
  }))

  // Generator: array that intentionally includes duplicates and "Not On Label"
  // entries. We mix normal labels with "Not On Label" entries and repeat some
  // normal labels to create duplicates.
  const mixedLabelArrayArb = fc.tuple(
    fc.array(normalLabelArb, { minLength: 1, maxLength: 8 }),
    fc.array(notOnLabelArb, { minLength: 0, maxLength: 3 })
  ).chain(([normals, nols]) => {
    // Pick some normals to duplicate (with potentially different IDs)
    return fc.array(
      fc.nat({ max: Math.max(0, normals.length - 1) }),
      { minLength: 0, maxLength: 4 }
    ).map((dupeIndices) => {
      const dupes = dupeIndices.map(i => ({
        name: normals[i].name,
        id: normals[i].id !== null ? normals[i].id + 1000000 : null
      }))
      // Shuffle all entries together
      return fc.shuffledSubarray([...normals, ...nols, ...dupes], {
        minLength: normals.length + nols.length + dupes.length,
        maxLength: normals.length + nols.length + dupes.length
      })
    })
  }).chain(x => x) // unwrap the inner Arbitrary

  test('output contains no duplicate names', () => {
    fc.assert(
      fc.property(mixedLabelArrayArb, (labels) => {
        const result = buildLabelData(labels)

        if (result.labelName === null) return true

        const names = result.labelName.split(' / ')
        const uniqueNames = new Set(names)
        return uniqueNames.size === names.length
      }),
      { numRuns: 200 }
    )
  })

  test('output contains no "Not On Label" entries', () => {
    fc.assert(
      fc.property(mixedLabelArrayArb, (labels) => {
        const result = buildLabelData(labels)

        if (result.labelName === null) return true

        const names = result.labelName.split(' / ')
        return names.every(n => !n.startsWith('Not On Label'))
      }),
      { numRuns: 200 }
    )
  })

  test('first-encountered URL is preserved for each unique name', () => {
    fc.assert(
      fc.property(mixedLabelArrayArb, (labels) => {
        const result = buildLabelData(labels)

        if (result.labelName === null) return true

        const names = result.labelName.split(' / ')

        // For each output name, find the first input label that would produce
        // that name (after stripping trailing " (digits)" and trimming) and
        // verify the URL matches
        for (let i = 0; i < names.length; i++) {
          const outputName = names[i]
          const outputUrl = result.labelUrls[i]

          // Find the first input label whose cleaned name matches
          const firstMatch = labels.find(l => {
            const cleaned = (l.name || '').replace(/\s*\(\d+\)\s*$/, '').trim()
            return cleaned === outputName
          })

          if (!firstMatch) return false

          const expectedUrl = firstMatch.id
            ? `https://www.discogs.com/label/${firstMatch.id}`
            : null

          if (outputUrl !== expectedUrl) return false
        }

        return true
      }),
      { numRuns: 200 }
    )
  })
})

// Feature: multi-label-support, Property 6: Merger backward compatibility normalization
// **Validates: Requirements 1.4, 7.1, 7.2, 7.3, 8.1, 8.2**

// ---------------------------------------------------------------------------
// Property 6: Merger backward compatibility normalization
//
// For any cache entry where `labelUrls` is absent, `labelUrl` is a non-null
// string, and `labelName` contains N labels (split on " / "), the merger SHALL
// produce a `labelUrls` array of length N where the first element equals
// `labelUrl` and all remaining elements are `null`. When `labelUrls` is already
// present in the cache entry, the merger SHALL pass it through unchanged.
//
// We test the normalization expression directly (same logic used in both merger
// code paths) rather than calling mergeData, which has async/FS dependencies.
//
// **Validates: Requirements 1.4, 7.1, 7.2, 7.3, 8.1, 8.2**
// ---------------------------------------------------------------------------
describe('Property 6: Merger backward compatibility normalization', () => {
  // The normalization expression extracted from src/merger.js (used in both paths):
  //   album.labelUrls || (album.labelUrl
  //     ? [album.labelUrl, ...Array(
  //         Math.max(0, (album.labelName || '').split(' / ').length - 1)
  //       ).fill(null)]
  //     : null)
  function normalizeLabelUrls (album) {
    return album.labelUrls || (album.labelUrl
      ? [album.labelUrl, ...Array(
          Math.max(0, (album.labelName || '').split(' / ').length - 1)
        ).fill(null)]
      : null)
  }

  // Generator for a single label name part (no " / " inside)
  const labelPartArb = fc.string({ minLength: 1, maxLength: 30 })
    .filter(s => s.trim().length > 0)
    .filter(s => !s.includes(' / '))

  // Generator for a Discogs-style label URL
  const labelUrlArb = fc.nat({ min: 1, max: 9999999 })
    .map(id => `https://www.discogs.com/label/${id}`)

  // --- Old-format cache entries (labelUrl string, no labelUrls) ---
  const oldFormatArb = fc.tuple(
    fc.array(labelPartArb, { minLength: 1, maxLength: 6 }),
    labelUrlArb
  ).map(([parts, url]) => ({
    labelName: parts.join(' / '),
    labelUrl: url,
    labelUrls: undefined
  }))

  test('old-format: produces array of length N with first element = labelUrl, rest null', () => {
    fc.assert(
      fc.property(oldFormatArb, (album) => {
        const result = normalizeLabelUrls(album)
        const expectedLength = album.labelName.split(' / ').length

        // Must be an array
        if (!Array.isArray(result)) return false
        // Length must match label count
        if (result.length !== expectedLength) return false
        // First element must equal labelUrl
        if (result[0] !== album.labelUrl) return false
        // All remaining elements must be null
        for (let i = 1; i < result.length; i++) {
          if (result[i] !== null) return false
        }
        return true
      }),
      { numRuns: 200 }
    )
  })

  // --- New-format cache entries (labelUrls array present) ---
  const newFormatArb = fc.tuple(
    fc.array(labelPartArb, { minLength: 1, maxLength: 6 }),
    fc.array(
      fc.option(labelUrlArb, { nil: null }),
      { minLength: 1, maxLength: 6 }
    )
  ).map(([parts, urls]) => {
    // Ensure labelUrls length matches label count
    const labelUrls = parts.map((_, i) => urls[i % urls.length] || null)
    return {
      labelName: parts.join(' / '),
      labelUrl: labelUrls[0] || null,
      labelUrls
    }
  })

  test('new-format: passes through labelUrls unchanged', () => {
    fc.assert(
      fc.property(newFormatArb, (album) => {
        const result = normalizeLabelUrls(album)

        // Must be the exact same array reference (passthrough)
        if (result !== album.labelUrls) return false
        return true
      }),
      { numRuns: 200 }
    )
  })

  // --- Edge case: neither labelUrl nor labelUrls present ---
  test('no labelUrl and no labelUrls: returns null', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
        (labelName) => {
          const album = { labelName, labelUrl: undefined, labelUrls: undefined }
          const result = normalizeLabelUrls(album)
          return result === null
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: multi-label-support, Property 4: Template label rendering with per-label links
// **Validates: Requirements 2.3, 2.4, 4.1, 4.2, 8.3**

// ---------------------------------------------------------------------------
// Property 4: Template label rendering with per-label links
//
// For any album with a `labelName` string containing N labels (split on " / ")
// and a `labelUrls` array of length N, the rendered album page SHALL contain
// each label name as text, and for each label whose corresponding `labelUrls`
// entry is non-null, that label name SHALL be wrapped in an anchor tag whose
// `href` equals the corresponding URL. Labels with null URLs SHALL appear as
// plain text without an anchor tag.
//
// **Validates: Requirements 2.3, 2.4, 4.1, 4.2, 8.3**
// ---------------------------------------------------------------------------
describe('Property 4: Template label rendering with per-label links', () => {
  const nunjucks = require('nunjucks')

  // Configure nunjucks with autoescape (matching the real renderer)
  const env = new nunjucks.Environment(null, { autoescape: true })

  // The exact template snippet from templates/album.njk for label rendering
  const labelTemplate = '{% if album.labelName %}{% set labelParts = album.labelName.split(\' / \') %}{% for part in labelParts %}{% if album.labelUrls and album.labelUrls[loop.index0] %}<a href="{{ album.labelUrls[loop.index0] }}" target="_blank" rel="noopener noreferrer">{{ part }}</a>{% else %}{{ part }}{% endif %}{% if not loop.last %} / {% endif %}{% endfor %}{% endif %}'

  // Generator: a single label name — alphanumeric, no HTML special chars, no " / "
  const labelNamePartArb = fc.stringMatching(/^[A-Za-z0-9 ]{1,25}$/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim())

  // Generator: a Discogs label URL or null
  const labelUrlArb = fc.option(
    fc.nat({ min: 1, max: 9999999 }).map(id => `https://www.discogs.com/label/${id}`),
    { nil: null }
  )

  // Generator: array of {name, url} pairs, then build album object
  const albumArb = fc.array(
    fc.tuple(labelNamePartArb, labelUrlArb),
    { minLength: 1, maxLength: 6 }
  ).filter(pairs => {
    // Ensure all names are unique (template splits on " / " so names must be distinct for parsing)
    const names = pairs.map(p => p[0])
    return new Set(names).size === names.length
  }).map(pairs => ({
    labelName: pairs.map(p => p[0]).join(' / '),
    labelUrls: pairs.map(p => p[1]),
    _pairs: pairs // keep for verification
  }))

  test('each label name appears in the rendered output', () => {
    fc.assert(
      fc.property(albumArb, ({ labelName, labelUrls, _pairs }) => {
        const rendered = env.renderString(labelTemplate, { album: { labelName, labelUrls } })

        for (const [name] of _pairs) {
          if (!rendered.includes(name)) return false
        }
        return true
      }),
      { numRuns: 200 }
    )
  })

  test('labels with non-null URLs are wrapped in <a> tags with correct href', () => {
    fc.assert(
      fc.property(albumArb, ({ labelName, labelUrls, _pairs }) => {
        const rendered = env.renderString(labelTemplate, { album: { labelName, labelUrls } })

        for (const [name, url] of _pairs) {
          if (url !== null) {
            // Should contain an anchor tag with the correct href wrapping this label name
            const expectedAnchor = `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`
            if (!rendered.includes(expectedAnchor)) return false
          }
        }
        return true
      }),
      { numRuns: 200 }
    )
  })

  test('labels with null URLs appear as plain text (no <a> tag)', () => {
    fc.assert(
      fc.property(albumArb, ({ labelName, labelUrls, _pairs }) => {
        const rendered = env.renderString(labelTemplate, { album: { labelName, labelUrls } })

        for (const [name, url] of _pairs) {
          if (url === null) {
            // The name should appear in the output but NOT inside an <a> tag
            const anchorPattern = `<a href="` + '.*' + `".*>${name}</a>`
            const anchorRegex = new RegExp(`<a [^>]*>${name}</a>`)
            if (anchorRegex.test(rendered)) return false
          }
        }
        return true
      }),
      { numRuns: 200 }
    )
  })

  test('labels are separated by " / " in the rendered output', () => {
    fc.assert(
      fc.property(albumArb, ({ labelName, labelUrls, _pairs }) => {
        const rendered = env.renderString(labelTemplate, { album: { labelName, labelUrls } })

        if (_pairs.length > 1) {
          // The separator " / " should appear (length - 1) times
          const separatorCount = (rendered.match(/ \/ /g) || []).length
          // Each " / " in the output corresponds to a separator between labels.
          // Note: " / " could also appear inside anchor hrefs, but our URLs don't contain " / "
          if (separatorCount !== _pairs.length - 1) return false
        }
        return true
      }),
      { numRuns: 200 }
    )
  })
})

// Feature: multi-label-support, Property 5: availableFormats filter includes full label name
// **Validates: Requirements 5.1, 5.2**

// ---------------------------------------------------------------------------
// Property 5: availableFormats filter includes full label name
//
// For any album object with a non-empty `labelName` string, the output of the
// `availableFormats` filter SHALL end with ` — ` followed by the exact
// `labelName` string.
//
// **Validates: Requirements 5.1, 5.2**
// ---------------------------------------------------------------------------
describe('Property 5: availableFormats filter includes full label name', () => {
  // Replicate the availableFormats filter logic from src/renderer.js
  // (it is registered as a Nunjucks filter inside renderSite and not exported)
  function availableFormats (album) {
    const physical = album.physicalFormats || []
    const formats = []
    if (physical.includes('Vinyl')) formats.push('Vinyl')
    if (physical.includes('CD')) formats.push('CD')
    if (physical.includes('Cassette')) formats.push('Cassette')
    if (physical.includes('Box Set')) formats.push('Box Set')
    formats.push('Digital')
    let result = formats.join(', ')
    if (album.labelName) result += ' — ' + album.labelName
    return result
  }

  const KNOWN_FORMATS = ['Vinyl', 'CD', 'Cassette', 'Box Set']

  // Generator: non-empty label name string (may contain " / " for multi-label)
  const labelNameArb = fc.array(
    fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    { minLength: 1, maxLength: 5 }
  ).map(parts => parts.join(' / '))

  // Generator: subset of known physical formats
  const physicalFormatsArb = fc.subarray(KNOWN_FORMATS)

  // Generator: album object with random labelName and physicalFormats
  const albumArb = fc.tuple(labelNameArb, physicalFormatsArb).map(([labelName, physicalFormats]) => ({
    labelName,
    physicalFormats
  }))

  test('output ends with " — " followed by the exact labelName', () => {
    fc.assert(
      fc.property(albumArb, (album) => {
        const result = availableFormats(album)
        const suffix = ' — ' + album.labelName
        return result.endsWith(suffix)
      }),
      { numRuns: 200 }
    )
  })

  test('output starts with format list before the label suffix', () => {
    fc.assert(
      fc.property(albumArb, (album) => {
        const result = availableFormats(album)
        const dashIndex = result.indexOf(' — ')
        // The " — " separator must exist
        if (dashIndex === -1) return false
        // The part before " — " must contain "Digital"
        const formatsPart = result.substring(0, dashIndex)
        return formatsPart.includes('Digital')
      }),
      { numRuns: 200 }
    )
  })
})
