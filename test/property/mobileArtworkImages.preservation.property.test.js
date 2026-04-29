'use strict'

/**
 * Preservation Property Tests — Mobile Artwork Images
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * Property 3: Preservation - Desktop WebP, Existing Mobile Sources, External URLs,
 * and Placeholders Unchanged
 *
 * IMPORTANT: These tests MUST PASS on the current UNFIXED code.
 * They verify existing correct behavior that must not regress after the fix.
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
const labelDir = path.join(__dirname, '..', '..', 'templates', 'label')
const sharedDir = path.join(__dirname, '..', '..', 'templates', 'shared')
const env = nunjucks.configure([labelDir, sharedDir], { autoescape: true })

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
// Test 1: Desktop <source srcset="...webp" type="image/webp"> present for
//         local images in ALL templates
// Validates: Requirement 3.1
// ---------------------------------------------------------------------------
describe('Preservation: desktop WebP sources present for local images', () => {
  test('artist.njk hero has desktop <source> with toWebp', () => {
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

          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const firstPicture = pictureRegex.exec(html)
          expect(firstPicture).not.toBeNull()

          const content = firstPicture[1]
          // Desktop source with .webp and type="image/webp" must be present
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })

  test('artist.njk discography has desktop <source> with toWebp', () => {
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

          const discoSection = html.substring(html.indexOf('class="discography"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(discoSection)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })

  test('artist.njk gallery has desktop <source> with toWebp', () => {
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

          const gallerySection = html.substring(html.indexOf('class="artist-gallery"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(gallerySection)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })

  test('album.njk hero has desktop <source> with toWebp', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          artworkFile: fc.constantFrom('artwork.jpg', 'artwork.png')
        }),
        ({ artistSlug, albumSlug, artworkFile }) => {
          const html = nunjucks.render('album.njk', baseCtx({
            artist: { name: 'Test Artist', slug: artistSlug },
            album: { title: 'Test Album', slug: albumSlug, artwork: artworkFile },
            isCompilation: false,
            rootPath: '../../../'
          }))

          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const firstPicture = pictureRegex.exec(html)
          expect(firstPicture).not.toBeNull()

          const content = firstPicture[1]
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })

  test('index.njk artist grid has desktop <source> with toWebp', () => {
    fc.assert(
      fc.property(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          photoFile: fc.constantFrom('photo.jpg', 'photo.png')
        }),
        ({ slug, photoFile }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            artists: [{ name: 'Test Artist', slug, photo: photoFile }],
            rootPath: './'
          }))

          const artistSection = html.substring(html.indexOf('class="artist-grid"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(artistSection)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })

  test('index.njk releases grid has desktop <source> with toWebp', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          artworkFile: fc.constantFrom('artwork.jpg', 'artwork.png')
        }),
        ({ artistSlug, albumSlug, artworkFile }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            latestReleases: [{
              title: 'Test Album',
              slug: albumSlug,
              artistName: 'Test Artist',
              artistSlug,
              artwork: artworkFile,
              releaseDate: '2024-01-01'
            }],
            totalReleases: 1,
            rootPath: './'
          }))

          const releaseSection = html.substring(html.indexOf('class="release-grid"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(releaseSection)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })

  test('releases.njk has desktop <source> with toWebp', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          artworkFile: fc.constantFrom('artwork.jpg', 'artwork.png')
        }),
        ({ artistSlug, albumSlug, artworkFile }) => {
          const html = nunjucks.render('releases.njk', baseCtx({
            allAlbums: [{
              title: 'Test Album',
              slug: albumSlug,
              artistName: 'Test Artist',
              artistSlug,
              artwork: artworkFile,
              releaseDate: '2024-01-01'
            }],
            rootPath: '../'
          }))

          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(html)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/type="image\/webp"/)
          expect(content).toMatch(/\.webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })
})


// ---------------------------------------------------------------------------
// Test 2: index.njk artist grid already has mobile <source> with toMobileWebp
// Validates: Requirement 3.2
// ---------------------------------------------------------------------------
describe('Preservation: index.njk artist grid mobile sources already present', () => {
  test('artist grid <picture> contains mobile <source> with toMobileWebp', () => {
    fc.assert(
      fc.property(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          photoFile: fc.constantFrom('photo.jpg', 'photo.png', 'photo.jpeg')
        }),
        ({ slug, photoFile }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            artists: [{ name: 'Test Artist', slug, photo: photoFile }],
            rootPath: './'
          }))

          const artistSection = html.substring(html.indexOf('class="artist-grid"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(artistSection)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/media="\(max-width: 640px\)"/)
          expect(content).toMatch(/-mobile\.webp/)
          expect(content).toMatch(/type="image\/webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 3: index.njk releases grid already has mobile <source> with toMobileWebp
// Validates: Requirement 3.2
// ---------------------------------------------------------------------------
describe('Preservation: index.njk releases grid mobile sources already present', () => {
  test('releases grid <picture> contains mobile <source> with toMobileWebp', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          artworkFile: fc.constantFrom('artwork.jpg', 'artwork.png')
        }),
        ({ artistSlug, albumSlug, artworkFile }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            latestReleases: [{
              title: 'Test Album',
              slug: albumSlug,
              artistName: 'Test Artist',
              artistSlug,
              artwork: artworkFile,
              releaseDate: '2024-01-01'
            }],
            totalReleases: 1,
            rootPath: './'
          }))

          const releaseSection = html.substring(html.indexOf('class="release-grid"'))
          const pictureRegex = /<picture>([\s\S]*?)<\/picture>/g
          const match = pictureRegex.exec(releaseSection)
          expect(match).not.toBeNull()

          const content = match[1]
          expect(content).toMatch(/media="\(max-width: 640px\)"/)
          expect(content).toMatch(/-mobile\.webp/)
          expect(content).toMatch(/type="image\/webp"/)
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 4: External image URLs render as plain <img> tags (no <picture>)
// Validates: Requirement 3.5
// ---------------------------------------------------------------------------
describe('Preservation: external image URLs render as plain <img>', () => {
  test('artist.njk hero with external photo renders <img> without <picture>', () => {
    fc.assert(
      fc.property(
        fc.record({
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          externalUrl: fc.constantFrom(
            'https://example.com/photo.jpg',
            'https://cdn.images.com/artist.png',
            'http://external.site/img.jpeg'
          )
        }),
        ({ slug, externalUrl }) => {
          const html = nunjucks.render('artist.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug,
              photo: externalUrl,
              albums: [],
              galleryImages: []
            },
            rootPath: '../../'
          }))

          // Find the hero section
          const heroSection = html.substring(
            html.indexOf('class="site-hero artist-hero"'),
            html.indexOf('{% endblock %}') > -1 ? html.indexOf('{% endblock %}') : html.indexOf('class="artist-page"')
          )

          // The hero logo link should have a plain <img>, not wrapped in <picture>
          const logoLink = html.substring(
            html.indexOf('class="artist-hero-logo-link"'),
            html.indexOf('</a>', html.indexOf('class="artist-hero-logo-link"')) + 4
          )
          expect(logoLink).toContain('<img')
          expect(logoLink).not.toContain('<picture>')
        }
      ),
      { numRuns: 3 }
    )
  })

  test('album.njk hero with external artwork renders <img> without <picture>', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          externalUrl: fc.constantFrom(
            'https://example.com/artwork.jpg',
            'https://cdn.images.com/cover.png'
          )
        }),
        ({ artistSlug, albumSlug, externalUrl }) => {
          const html = nunjucks.render('album.njk', baseCtx({
            artist: { name: 'Test Artist', slug: artistSlug },
            album: { title: 'Test Album', slug: albumSlug, artwork: externalUrl },
            isCompilation: false,
            rootPath: '../../../'
          }))

          const logoLink = html.substring(
            html.indexOf('class="artist-hero-logo-link"'),
            html.indexOf('</a>', html.indexOf('class="artist-hero-logo-link"')) + 4
          )
          expect(logoLink).toContain('<img')
          expect(logoLink).not.toContain('<picture>')
        }
      ),
      { numRuns: 3 }
    )
  })

  test('index.njk news with external image renders <img> without <picture>', () => {
    fc.assert(
      fc.property(
        fc.record({
          articleSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          externalUrl: fc.constantFrom(
            'https://example.com/news-image.jpg',
            'https://cdn.images.com/feature.png'
          )
        }),
        ({ articleSlug, externalUrl }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            hasNews: true,
            newsArticles: [{
              title: 'Test Article',
              slug: articleSlug,
              imageUrl: externalUrl,
              date: '2024-06-01',
              excerpt: 'Test excerpt'
            }],
            totalNews: 1,
            rootPath: './'
          }))

          const newsSection = html.substring(html.indexOf('class="news-list"'))
          const newsItem = newsSection.substring(0, newsSection.indexOf('</article>'))

          // External URL should produce plain <img>, no <picture>
          expect(newsItem).toContain('<img')
          expect(newsItem).not.toContain('<picture>')
        }
      ),
      { numRuns: 3 }
    )
  })

  test('artist.njk discography with external artwork renders <img> without <picture>', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          externalUrl: fc.constantFrom(
            'https://example.com/artwork.jpg',
            'https://cdn.images.com/cover.png'
          )
        }),
        ({ artistSlug, albumSlug, externalUrl }) => {
          const html = nunjucks.render('artist.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug: artistSlug,
              photo: 'photo.jpg',
              albums: [{
                title: 'Test Album',
                slug: albumSlug,
                artwork: externalUrl,
                releaseDate: '2024-01-01'
              }],
              galleryImages: []
            },
            rootPath: '../../'
          }))

          const discoSection = html.substring(html.indexOf('class="discography"'))
          const releaseCard = discoSection.substring(
            discoSection.indexOf('class="release-card'),
            discoSection.indexOf('</a>', discoSection.indexOf('class="release-card')) + 4
          )
          expect(releaseCard).toContain('<img')
          expect(releaseCard).not.toContain('<picture>')
        }
      ),
      { numRuns: 3 }
    )
  })
})


// ---------------------------------------------------------------------------
// Test 5: Missing artwork renders artwork-placeholder.svg
// Validates: Requirement 3.6
// ---------------------------------------------------------------------------
describe('Preservation: missing artwork renders placeholder SVG', () => {
  test('artist.njk discography with no artwork shows artwork-placeholder.svg', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)
        }),
        ({ artistSlug, albumSlug }) => {
          const html = nunjucks.render('artist.njk', baseCtx({
            artist: {
              name: 'Test Artist',
              slug: artistSlug,
              photo: 'photo.jpg',
              albums: [{
                title: 'Test Album',
                slug: albumSlug,
                artwork: null,
                releaseDate: '2024-01-01'
              }],
              galleryImages: []
            },
            rootPath: '../../'
          }))

          const discoSection = html.substring(html.indexOf('class="discography"'))
          expect(discoSection).toContain('artwork-placeholder.svg')
        }
      ),
      { numRuns: 5 }
    )
  })

  test('index.njk releases grid with no artwork shows artwork-placeholder.svg', () => {
    fc.assert(
      fc.property(
        fc.record({
          artistSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
          albumSlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)
        }),
        ({ artistSlug, albumSlug }) => {
          const html = nunjucks.render('index.njk', baseCtx({
            latestReleases: [{
              title: 'Test Album',
              slug: albumSlug,
              artistName: 'Test Artist',
              artistSlug,
              artwork: null,
              releaseDate: '2024-01-01'
            }],
            totalReleases: 1,
            rootPath: './'
          }))

          const releaseSection = html.substring(html.indexOf('class="release-grid"'))
          expect(releaseSection).toContain('artwork-placeholder.svg')
        }
      ),
      { numRuns: 5 }
    )
  })
})

// ---------------------------------------------------------------------------
// Test 6: Images > 600px processed by optimizer produce -mobile.webp at 600px
// Validates: Requirement 3.1 (large image optimizer preservation)
// ---------------------------------------------------------------------------
describe('Preservation: optimizer generates -mobile.webp at 600px for large images', () => {
  test('an 800x800 image produces -mobile.webp resized to 600px width', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'img-pres-test-'))
    try {
      // Create an 800x800 test image (> 600px MOBILE_WIDTH)
      const imgBuffer = await sharp({
        create: { width: 800, height: 800, channels: 3, background: { r: 100, g: 150, b: 200 } }
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
      expect(fs.existsSync(mobileWebpPath)).toBe(true)

      // Verify the mobile variant is resized to 600px width
      const mobileMetadata = await sharp(await fsp.readFile(mobileWebpPath)).metadata()
      expect(mobileMetadata.width).toBe(600)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('a 1200x900 image produces -mobile.webp resized to 600px width', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'img-pres-test2-'))
    try {
      const imgBuffer = await sharp({
        create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 100, b: 50 } }
      }).jpeg().toBuffer()

      const imgPath = path.join(tmpDir, 'cover.jpg')
      await fsp.writeFile(imgPath, imgBuffer)

      const origLog = console.log
      const origWarn = console.warn
      console.log = () => {}
      console.warn = () => {}

      await optimizeImages(tmpDir)

      console.log = origLog
      console.warn = origWarn

      const mobileWebpPath = path.join(tmpDir, 'cover-mobile.webp')
      expect(fs.existsSync(mobileWebpPath)).toBe(true)

      const mobileMetadata = await sharp(await fsp.readFile(mobileWebpPath)).metadata()
      expect(mobileMetadata.width).toBe(600)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
