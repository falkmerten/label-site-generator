'use strict'

/**
 * Preservation Property Tests — News Article Image Slug
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 *
 * Property 2: Preservation - Non-Date-Prefixed Behavior Unchanged
 *
 * These tests MUST PASS on the UNFIXED code. They verify existing correct
 * behavior that must be preserved after the fix is applied:
 *   - Front-matter image takes precedence over auto-detection
 *   - Slug-only image files are detected correctly
 *   - No image file at all returns image: null
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

/** Generates a simple image filename for front-matter */
const fmImageArb = fc.constantFrom('banner.jpg', 'cover.png', 'hero.webp', 'photo.jpeg')

// ---------------------------------------------------------------------------
// Test 1: Front-matter image takes precedence (auto-detection skipped)
// ---------------------------------------------------------------------------
describe('Preservation: parseArticle respects front-matter image', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * When a news article has an explicit `image` field in its front-matter,
   * that value is used directly and auto-detection is skipped entirely.
   */
  test('articles with explicit front-matter image use that value', async () => {
    await fc.assert(
      fc.asyncProperty(
        slugArb, yearArb, monthArb, dayArb, fmImageArb,
        async (slug, year, month, day, fmImage) => {
          const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'news-pres-fm-'))
          try {
            const date = `${year}-${month}-${day}`
            const md = `---\ntitle: Test Article\nimage: ${fmImage}\n---\n\nSome content about ${slug}.`

            const result = parseArticle(md, slug, date, tmpDir)

            // Front-matter image should be resolved to yearPath + filename
            expect(result.image).toBe(path.join(tmpDir, fmImage))
          } finally {
            await fsp.rm(tmpDir, { recursive: true, force: true })
          }
        }
      ),
      { numRuns: 30 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 2: Slug-only image files are detected correctly
// ---------------------------------------------------------------------------
describe('Preservation: parseArticle detects slug-only image files', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * When an image file is named using only the slug (e.g. `my-article.jpg`),
   * parseArticle detects it via the existing {slug}.ext lookup.
   */
  test('articles with slug-only image files are detected', async () => {
    await fc.assert(
      fc.asyncProperty(
        slugArb, yearArb, monthArb, dayArb, extArb,
        async (slug, year, month, day, ext) => {
          const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'news-pres-slug-'))
          try {
            const date = `${year}-${month}-${day}`
            const slugOnlyPath = path.join(tmpDir, slug + ext)

            // Create a slug-only image file
            await fsp.writeFile(slugOnlyPath, 'dummy-image-data')

            const md = `# Test Article\n\nSome content about ${slug}.`
            const result = parseArticle(md, slug, date, tmpDir)

            // Should detect the slug-only image
            expect(result.image).toBe(slugOnlyPath)
          } finally {
            await fsp.rm(tmpDir, { recursive: true, force: true })
          }
        }
      ),
      { numRuns: 30 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 3: No image file returns null
// ---------------------------------------------------------------------------
describe('Preservation: parseArticle returns null when no image exists', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * When no image file exists for a news article (neither {slug}.ext nor
   * {MM-DD-slug}.ext), the image remains null.
   */
  test('articles with no image file return image: null', async () => {
    await fc.assert(
      fc.asyncProperty(
        slugArb, yearArb, monthArb, dayArb,
        async (slug, year, month, day) => {
          const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'news-pres-none-'))
          try {
            const date = `${year}-${month}-${day}`

            // No image files created — empty directory
            const md = `# Test Article\n\nSome content about ${slug}.`
            const result = parseArticle(md, slug, date, tmpDir)

            // Should be null when no image file exists
            expect(result.image).toBeNull()
          } finally {
            await fsp.rm(tmpDir, { recursive: true, force: true })
          }
        }
      ),
      { numRuns: 30 }
    )
  })
})
