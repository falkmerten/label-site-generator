'use strict'

/**
 * Bug Condition Exploration Test — News Article Image Slug
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * Property 1: Bug Condition - Date-Prefixed Image Not Detected
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * The bug: parseArticle() only looks for {slug}.ext images, but actual image files
 * use the date-prefixed naming convention {MM-DD-slug}.ext. When only a date-prefixed
 * image exists, parseArticle returns image: null instead of detecting it.
 */

// Mock the markdown module to avoid ESM issues with isomorphic-dompurify
jest.mock('../../src/markdown', () => ({
  renderMarkdown: (md) => `<p>${md}</p>`
}))

const fc = require('fast-check')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const { parseArticle } = require('../../src/news')

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a valid slug: lowercase letters, digits, hyphens, 3-20 chars */
const slugArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/)
  .filter(s => !s.endsWith('-') && !s.includes('--'))

/** Generates a valid month (01-12) */
const monthArb = fc.integer({ min: 1, max: 12 }).map(m => String(m).padStart(2, '0'))

/** Generates a valid day (01-28 to keep it simple) */
const dayArb = fc.integer({ min: 1, max: 28 }).map(d => String(d).padStart(2, '0'))

/** Generates a year */
const yearArb = fc.integer({ min: 2020, max: 2030 }).map(String)

/** Generates an image extension */
const extArb = fc.constantFrom('.jpg', '.jpeg', '.png', '.webp')

// ---------------------------------------------------------------------------
// Test: Date-prefixed image file exists but parseArticle returns null
// ---------------------------------------------------------------------------
describe('Bug Condition: parseArticle does not detect date-prefixed images', () => {
  test('parseArticle detects image when only date-prefixed file exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        slugArb, yearArb, monthArb, dayArb, extArb,
        async (slug, year, month, day, ext) => {
          const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'news-img-test-'))
          try {
            const date = `${year}-${month}-${day}`
            const datePrefixedName = `${month}-${day}-${slug}${ext}`
            const datePrefixedPath = path.join(tmpDir, datePrefixedName)

            // Create a dummy image file with date-prefixed name only
            await fsp.writeFile(datePrefixedPath, 'dummy-image-data')

            // Verify: slug-only file does NOT exist
            const slugOnlyPath = path.join(tmpDir, slug + ext)
            expect(fs.existsSync(slugOnlyPath)).toBe(false)

            // Verify: date-prefixed file DOES exist
            expect(fs.existsSync(datePrefixedPath)).toBe(true)

            // Call parseArticle with simple markdown content
            const md = `# Test Article\n\nSome content about ${slug}.`
            const result = parseArticle(md, slug, date, tmpDir)

            // BUG: On unfixed code, result.image will be null because
            // parseArticle only checks {slug}.ext, not {MM-DD-slug}.ext
            expect(result.image).not.toBeNull()
            expect(result.image).toBe(datePrefixedPath)
          } finally {
            await fsp.rm(tmpDir, { recursive: true, force: true })
          }
        }
      ),
      { numRuns: 20 }
    )
  })
})
