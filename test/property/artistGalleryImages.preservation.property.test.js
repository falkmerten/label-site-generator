'use strict'

/**
 * Preservation Property Tests — Artist Gallery Images Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Property 2: Preservation — Non-Gallery Asset Copying Unchanged
 *
 * IMPORTANT: These tests MUST PASS on the current UNFIXED code.
 * They verify existing correct behavior that must not regress after the fix.
 *
 * Observed behaviors on unfixed code:
 * - Artist photo with content/{slug}/photo.jpg is resolved and copied correctly
 * - External gallery URLs (starting with http) are skipped, no fs.copyFile called
 * - Artists with empty galleryImages or undefined cause no errors
 * - Gallery output directory is created with { recursive: true } even when copies fail
 */

const fc = require('fast-check')
const path = require('path')
const fsp = require('fs/promises')
const fs = require('fs')
const os = require('os')
const { copyAssets } = require('../../src/assets')

describe('Preservation: Artist photo path resolution unchanged', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-pres-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * **Validates: Requirements 3.3**
   *
   * Artist photo is resolved via content/{slug}/{filename} and copied to
   * dist/artists/{slug}/{filename}. This existing behavior must be preserved.
   */
  test('artist photo is resolved from contentDir/{slug}/{filename} and copied to output', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/),
          photoFile: fc.constantFrom('photo.jpg', 'photo.png', 'artist.jpeg')
        }),
        async ({ slug, photoFile }) => {
          const contentDir = path.join(tmpDir, 'content')
          const outputDir = path.join(tmpDir, 'dist')
          const artistContentDir = path.join(contentDir, slug)

          await fsp.mkdir(artistContentDir, { recursive: true })
          await fsp.mkdir(outputDir, { recursive: true })

          // Write a real photo file in content/{slug}/
          const photoContent = Buffer.from('photo-data-' + slug + '-' + photoFile)
          await fsp.writeFile(path.join(artistContentDir, photoFile), photoContent)

          const data = {
            artists: [{
              name: 'Test Artist ' + slug,
              slug,
              photo: photoFile,
              galleryImages: [],
              albums: []
            }]
          }

          const origWarn = console.warn
          const origLog = console.log
          console.warn = () => {}
          console.log = () => {}

          try {
            await copyAssets(data, contentDir, outputDir)
          } finally {
            console.warn = origWarn
            console.log = origLog
          }

          // Artist photo should be copied to dist/artists/{slug}/{filename}
          const destPath = path.join(outputDir, 'artists', slug, photoFile)
          expect(fs.existsSync(destPath)).toBe(true)

          const destContent = await fsp.readFile(destPath)
          expect(destContent).toEqual(photoContent)
        }
      ),
      { numRuns: 10 }
    )
  })
})


describe('Preservation: External gallery URLs are skipped', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-pres-ext-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * **Validates: Requirements 3.1**
   *
   * Gallery images starting with 'http' are external URLs and must be skipped.
   * No fs.copyFile should be called for them, and no files should appear in
   * the gallery output directory.
   */
  test('external gallery URLs (http) are skipped, no files copied to gallery output', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/),
          externalUrl: fc.constantFrom(
            'https://example.com/gallery/photo1.jpg',
            'http://cdn.images.com/band-live.png',
            'https://storage.cloud.com/img/01.jpeg'
          )
        }),
        async ({ slug, externalUrl }) => {
          const contentDir = path.join(tmpDir, 'content')
          const outputDir = path.join(tmpDir, 'dist')

          await fsp.mkdir(contentDir, { recursive: true })
          await fsp.mkdir(outputDir, { recursive: true })

          const data = {
            artists: [{
              name: 'Test Artist ' + slug,
              slug,
              galleryImages: [externalUrl],
              albums: []
            }]
          }

          const origWarn = console.warn
          const origLog = console.log
          console.warn = () => {}
          console.log = () => {}

          try {
            await copyAssets(data, contentDir, outputDir)
          } finally {
            console.warn = origWarn
            console.log = origLog
          }

          // The gallery output directory may or may not exist, but if it does,
          // it should contain no files (external URLs are skipped)
          const galleryOutDir = path.join(outputDir, 'artists', slug, 'images')
          if (fs.existsSync(galleryOutDir)) {
            const files = await fsp.readdir(galleryOutDir)
            expect(files).toHaveLength(0)
          }
        }
      ),
      { numRuns: 10 }
    )
  })
})

describe('Preservation: Empty or undefined galleryImages cause no errors', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-pres-empty-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * **Validates: Requirements 3.2**
   *
   * Artists with galleryImages: [] or galleryImages: undefined must be handled
   * without errors. No gallery directory should be created for these artists.
   */
  test('artists with empty galleryImages array cause no errors', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/)
        }),
        async ({ slug }) => {
          const contentDir = path.join(tmpDir, 'content')
          const outputDir = path.join(tmpDir, 'dist')

          await fsp.mkdir(contentDir, { recursive: true })
          await fsp.mkdir(outputDir, { recursive: true })

          const data = {
            artists: [{
              name: 'Test Artist ' + slug,
              slug,
              galleryImages: [],
              albums: []
            }]
          }

          const origWarn = console.warn
          const origLog = console.log
          console.warn = () => {}
          console.log = () => {}

          try {
            // Should not throw
            await copyAssets(data, contentDir, outputDir)
          } finally {
            console.warn = origWarn
            console.log = origLog
          }

          // Gallery images dir should NOT be created for empty array
          const galleryOutDir = path.join(outputDir, 'artists', slug, 'images')
          expect(fs.existsSync(galleryOutDir)).toBe(false)
        }
      ),
      { numRuns: 10 }
    )
  })

  test('artists with undefined galleryImages cause no errors', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/)
        }),
        async ({ slug }) => {
          const contentDir = path.join(tmpDir, 'content')
          const outputDir = path.join(tmpDir, 'dist')

          await fsp.mkdir(contentDir, { recursive: true })
          await fsp.mkdir(outputDir, { recursive: true })

          const data = {
            artists: [{
              name: 'Test Artist ' + slug,
              slug,
              // galleryImages intentionally omitted (undefined)
              albums: []
            }]
          }

          const origWarn = console.warn
          const origLog = console.log
          console.warn = () => {}
          console.log = () => {}

          try {
            // Should not throw
            await copyAssets(data, contentDir, outputDir)
          } finally {
            console.warn = origWarn
            console.log = origLog
          }

          // Gallery images dir should NOT be created for undefined
          const galleryOutDir = path.join(outputDir, 'artists', slug, 'images')
          expect(fs.existsSync(galleryOutDir)).toBe(false)
        }
      ),
      { numRuns: 10 }
    )
  })
})

describe('Preservation: Gallery output directory created with recursive even when copies fail', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-pres-dir-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * **Validates: Requirements 3.5**
   *
   * When an artist has gallery images (even if they fail to copy due to the bug),
   * the gallery output directory dist/artists/{slug}/images/ is still created
   * with { recursive: true }.
   */
  test('gallery output directory is created even when image copies fail', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/),
          filename: fc.stringMatching(/^[a-z0-9]{1,8}\.(jpg|png)$/)
        }),
        async ({ slug, filename }) => {
          const contentDir = path.join(tmpDir, 'content')
          const outputDir = path.join(tmpDir, 'dist')

          await fsp.mkdir(contentDir, { recursive: true })
          await fsp.mkdir(outputDir, { recursive: true })

          // Do NOT create the source image file — copies will fail
          const data = {
            artists: [{
              name: 'Test Artist ' + slug,
              slug,
              galleryImages: [filename], // basename only, file doesn't exist
              albums: []
            }]
          }

          const origWarn = console.warn
          const origLog = console.log
          console.warn = () => {}
          console.log = () => {}

          try {
            await copyAssets(data, contentDir, outputDir)
          } finally {
            console.warn = origWarn
            console.log = origLog
          }

          // The gallery output directory should still be created
          const galleryOutDir = path.join(outputDir, 'artists', slug, 'images')
          expect(fs.existsSync(galleryOutDir)).toBe(true)

          // But it should be empty (copies failed)
          const files = await fsp.readdir(galleryOutDir)
          expect(files).toHaveLength(0)
        }
      ),
      { numRuns: 10 }
    )
  })
})
