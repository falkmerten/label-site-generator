'use strict'

/**
 * Bug Condition Exploration Test — Artist Gallery Images Not Copied
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * Property 1: Bug Condition — Gallery Images Not Copied Due to Missing Path Resolution
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * The bug: copyAssets() uses gallery image basenames (e.g. '01.jpg') directly as
 * fs.copyFile source paths instead of resolving them against contentDir. The ENOENT
 * error is silently swallowed, so dist/artists/{slug}/images/ ends up empty.
 */

const fc = require('fast-check')
const path = require('path')
const fsp = require('fs/promises')
const fs = require('fs')
const os = require('os')
const { copyAssets } = require('../../src/assets')

describe('Bug Condition: Gallery images not copied due to missing path resolution', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-bug-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  test('gallery image file is copied from contentDir/{slug}/images/ to dist/artists/{slug}/images/', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/),
          filename: fc.stringMatching(/^[a-z0-9]{1,8}\.(jpg|png)$/)
        }),
        async ({ slug, filename }) => {
          // Set up temp content and output directories
          const contentDir = path.join(tmpDir, 'content')
          const outputDir = path.join(tmpDir, 'dist')
          const gallerySourceDir = path.join(contentDir, slug, 'images')

          await fsp.mkdir(gallerySourceDir, { recursive: true })
          await fsp.mkdir(outputDir, { recursive: true })

          // Write a real image file in the content gallery directory
          const imageContent = Buffer.from('fake-image-data-' + slug + '-' + filename)
          await fsp.writeFile(path.join(gallerySourceDir, filename), imageContent)

          // Build minimal artist data with gallery image as basename only
          // (this is what mergeData() produces)
          const data = {
            artists: [{
              name: 'Test Artist ' + slug,
              slug,
              galleryImages: [filename], // basename only — the bug condition
              albums: []
            }]
          }

          // Suppress console output during copyAssets
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

          // Assert: the gallery image should exist in the output directory
          const destPath = path.join(outputDir, 'artists', slug, 'images', filename)
          const exists = fs.existsSync(destPath)
          expect(exists).toBe(true)

          // Assert: content should match the source
          if (exists) {
            const destContent = await fsp.readFile(destPath)
            expect(destContent).toEqual(imageContent)
          }
        }
      ),
      { numRuns: 10 }
    )
  })
})
