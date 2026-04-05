'use strict'

/**
 * Bug Condition Exploration Test — Mobile Artwork Images
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
 *
 * Property 1: Bug Condition - Missing Mobile Sources and Skipped Mobile Variant Generation
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 */

const fc = require('fast-check')
const path = require('path')
const nunjucks = require('nunjucks')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const sharp = require('sharp')
const { optimizeImages } = require('../../src/imageOptimizer')

// ---------------------------------------------------------------------------
// Nunjucks setup — mirrors src/renderer.js filters
// ---------------------------------------------------------------------------
const templatesDir = path.join(__dirname, '..', '..', 'templates')
const env = nunjucks.configure(templatesDir, { autoescape: true })

env.addFilter('isLocal', (url) => url && !url.startsWith('http'))
env.addFilter('toWebp', (url) => url ? url.replace(/\.(jpg|jpeg|png)$/i, '.webp') : url)
env.addFilter('toMobileWebp', (url) => url ? url.replace(/\.(jpg|jpeg|png)$/i, '-mobile.webp') : url)
env.addFilter('urlencode', (str) => encodeURIComponent(str || ''))
env.addFilter('storeUrl', (template, artistName, albumTitle) => {
  return (template || '')
    .replace(/\{artist\}/g, encodeURIComponent(artistName || ''))
    .replace(/\{album\}/g, encodeURIComponent(albumTitle || ''))
})
env.addFilter('availableFormats', (album) => {
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
})
env.addFilter('youtubeId', (url) => {
  if (!url) return ''
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : ''
})
env.addFilter('nl2br', (str) => str ? str.replace(/\r\n|\r|\n/g, '<br>') : '')
env.addFilter('formatDate', (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
})
env.addFilter('isFuture', (iso) => {
  if (!iso) return false
  return new Date(iso) > new Date()
})

// ---------------------------------------------------------------------------
// Shared base context for template rendering
// ---------------------------------------------------------------------------
function baseCtx (overrides) {
  return {
    labelName: 'Test Label',
    siteUrl: 'https://example.com/',
    gaMeasurementId: '',
    physicalStores: [],
    customStoreDefs: {},
    currentYear: 2025,
    newsletter: { actionUrl: '', listId: '', doubleOptIn: false },
    latestReleases: [],
    totalReleases: 0,
    labelBandcampUrl: '',
    labelEmail: '',
    labelAddress: '',
    labelVatId: '',
    extraPages: [],
    mainNavPages: [],
    footerNavPages: [],
    pages: {},
    social: {},
    newsArticles: [],
    hasNews: false,
    totalNews: 0,
    allEvents: [],
    hasEvents: false,
    artists: [],
    rootPath: './',
    canonicalUrl: null,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hasMobileSource (html, pictureContext) {
  // Find all <picture> blocks in the HTML
  const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
  let match
  while ((match = pictureRegex.exec(html)) !== null) {
    const pictureContent = match[1]
    // Check if this picture block is in the right context
    if (pictureContext && !pictureContent.includes(pictureContext)) continue
    // Check for mobile source
    if (pictureContent.includes('media="(max-width: 640px)"') &&
        pictureContent.includes('-mobile.webp') &&
        pictureContent.includes('type="image/webp"')) {
      return true
    }
  }
  return false
}


// ---------------------------------------------------------------------------
// Test 1: artist.njk hero — local photo must have mobile <source>
// Validates: Requirement 1.2
// ---------------------------------------------------------------------------
describe('Bug Condition: artist.njk hero mobile source', () => {
  test('artist hero <picture> contains mobile <source> with toMobileWebp srcset', () => {
    fc.assert(
      fc.property(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          photoFile: fc.constantFrom('photo.jpg', 'photo.png', 'photo.jpeg')
        }),
        ({ slug, photoFile }) => {
          const html = nunjucks.render('artist.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug,
              photo: photoFile,
              albums: [],
              galleryImages: []
            },
            rootPath: '../../'
          }))

          // The hero <picture> should contain a mobile <source>
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const firstPicture = pictureRegex.exec(html)
          expect(firstPicture).not.toBeNull()

          const pictureContent = firstPicture[1]
          // Must have mobile source with media query and -mobile.webp
          expect(pictureContent).toMatch(/media="\(max-width: 640px\)"/)
          expect(pictureContent).toMatch(/-mobile\.webp/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 2: artist.njk discography — local artwork must have mobile <source>
// Validates: Requirement 1.1
// ---------------------------------------------------------------------------
describe('Bug Condition: artist.njk discography mobile source', () => {
  test('discography <picture> contains mobile <source> with toMobileWebp srcset', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          artworkFile: fc.constantFrom('artwork.jpg', 'artwork.png')
        }),
        ({ artistSlug, albumSlug, artworkFile }) => {
          const html = nunjucks.render('artist.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug: artistSlug,
              photo: 'photo.jpg',
              albums: [{
                title: 'Test Album',
                slug: albumSlug,
                artwork: artworkFile,
                releaseDate: '2024-01-01'
              }],
              galleryImages: []
            },
            rootPath: '../../'
          }))

          // Find the discography section
          const discoSection = html.substring(html.indexOf('class="discography"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(discoSection)
          expect(match).not.toBeNull()

          const pictureContent = match[1]
          expect(pictureContent).toMatch(/media="\(max-width: 640px\)"/)
          expect(pictureContent).toMatch(/-mobile\.webp/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 3: artist.njk gallery — local images must have mobile <source>
// Validates: Requirement 1.3
// ---------------------------------------------------------------------------
describe('Bug Condition: artist.njk gallery mobile source', () => {
  test('gallery <picture> contains mobile <source> with toMobileWebp srcset', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          galleryImg: fc.constantFrom('img1.jpg', 'img2.png', 'photo-live.jpeg')
        }),
        ({ artistSlug, galleryImg }) => {
          const html = nunjucks.render('artist.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug: artistSlug,
              photo: 'photo.jpg',
              albums: [],
              galleryImages: [galleryImg]
            },
            rootPath: '../../'
          }))

          // Find the gallery section
          const gallerySection = html.substring(html.indexOf('class="artist-gallery"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(gallerySection)
          expect(match).not.toBeNull()

          const pictureContent = match[1]
          expect(pictureContent).toMatch(/media="\(max-width: 640px\)"/)
          expect(pictureContent).toMatch(/-mobile\.webp/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 4: album.njk hero — local artwork must have mobile <source>
// Validates: Requirement 1.4
// ---------------------------------------------------------------------------
describe('Bug Condition: album.njk hero mobile source', () => {
  test('album hero <picture> contains mobile <source> with toMobileWebp srcset', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          artworkFile: fc.constantFrom('artwork.jpg', 'artwork.png')
        }),
        ({ artistSlug, albumSlug, artworkFile }) => {
          const html = nunjucks.render('album.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug: artistSlug
            },
            album: {
              title: 'Test Album',
              slug: albumSlug,
              artwork: artworkFile
            },
            isCompilation: false,
            rootPath: '../../../'
          }))

          // Find the hero <picture>
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const firstPicture = pictureRegex.exec(html)
          expect(firstPicture).not.toBeNull()

          const pictureContent = firstPicture[1]
          expect(pictureContent).toMatch(/media="\(max-width: 640px\)"/)
          expect(pictureContent).toMatch(/-mobile\.webp/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 5: index.njk news — local images must have mobile <source>
// Validates: Requirement 1.5
// ---------------------------------------------------------------------------
describe('Bug Condition: index.njk news mobile source', () => {
  test('news <picture> contains mobile <source> with toMobileWebp srcset', () => {
    fc.assert(
      fc.property(
        fc.record({
          articleSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          imageFile: fc.constantFrom('image.jpg', 'cover.png', 'feature.jpeg')
        }),
        ({ articleSlug, imageFile }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            hasNews: true,
            newsArticles: [{
              title: 'Test Article',
              slug: articleSlug,
              imageUrl: imageFile,
              date: '2024-06-01',
              excerpt: 'Test excerpt'
            }],
            totalNews: 1,
            rootPath: './'
          }))

          // Find the news section
          const newsSection = html.substring(html.indexOf('class="news-list"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(newsSection)
          expect(match).not.toBeNull()

          const pictureContent = match[1]
          expect(pictureContent).toMatch(/media="\(max-width: 640px\)"/)
          expect(pictureContent).toMatch(/-mobile\.webp/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 6: imageOptimizer — small image (≤600px) must generate -mobile.webp
// Validates: Requirement 1.6
// ---------------------------------------------------------------------------
describe('Bug Condition: optimizer generates mobile variant for small images', () => {
  test('a 400x400 image processed by optimizeImages produces -mobile.webp', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'img-opt-test-'))
    try {
      // Create a 400x400 test image
      const imgBuffer = await sharp({
        create: { width: 400, height: 400, channels: 3, background: { r: 128, g: 128, b: 128 } }
      }).jpeg().toBuffer()

      const imgPath = path.join(tmpDir, 'artwork.jpg')
      await fsp.writeFile(imgPath, imgBuffer)

      // Suppress console output
      const origLog = console.log
      const origWarn = console.warn
      console.log = () => {}
      console.warn = () => {}

      await optimizeImages(tmpDir)

      console.log = origLog
      console.warn = origWarn

      // Check that -mobile.webp was created
      const mobileWebpPath = path.join(tmpDir, 'artwork-mobile.webp')
      const exists = fs.existsSync(mobileWebpPath)
      expect(exists).toBe(true)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
