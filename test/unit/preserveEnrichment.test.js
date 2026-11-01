'use strict'

const { preserveEnrichment } = require('../../src/refreshArtist')
const { parseRfc4180 } = require('../../src/importCsv')

describe('preserveEnrichment (full --scrape)', () => {
  const oldCache = {
    artists: [{
      name: 'Amáutica',
      url: 'https://amautica.bandcamp.com',
      streamingLinks: { spotify: 'https://open.spotify.com/artist/x' },
      lastfm: { listeners: 1200 },
      albums: [{
        title: 'First Light',
        url: 'https://amautica.bandcamp.com/album/first-light',
        slug: 'first-light-2',
        upc: '123456789012',
        releaseDate: '2024-03-01',
        streamingLinks: { spotify: 'https://open.spotify.com/album/y' },
        physicalFormats: ['Vinyl']
      }]
    }]
  }

  function freshScrape () {
    return {
      artists: [{
        name: 'Amáutica',
        url: 'https://amautica.bandcamp.com',
        streamingLinks: undefined,
        albums: [
          { title: 'First Light', url: 'https://amautica.bandcamp.com/album/first-light', releaseDate: '2024-03-08', streamingLinks: undefined },
          { title: 'Brand New', url: 'https://amautica.bandcamp.com/album/brand-new' }
        ]
      }]
    }
  }

  test('keeps album and artist enrichment, slug and release date', () => {
    const fresh = freshScrape()
    const stats = preserveEnrichment(oldCache, fresh)
    const artist = fresh.artists[0]
    const album = artist.albums[0]

    expect(stats).toEqual({ artists: 1, albums: 1 })
    expect(artist.streamingLinks.spotify).toBe('https://open.spotify.com/artist/x')
    expect(artist.lastfm).toEqual({ listeners: 1200 })
    expect(album.upc).toBe('123456789012')
    expect(album.slug).toBe('first-light-2')
    expect(album.releaseDate).toBe('2024-03-01')
    expect(album.streamingLinks.spotify).toBe('https://open.spotify.com/album/y')
    expect(artist.albums[1].streamingLinks).toBeUndefined()
  })

  test('fresh Bandcamp packages win over cached physicalFormats', () => {
    const fresh = freshScrape()
    fresh.artists[0].albums[0].raw = { packages: [{ type_name: 'Vinyl LP' }] }
    preserveEnrichment(oldCache, fresh)
    expect(fresh.artists[0].albums[0].physicalFormats).toBeUndefined()
  })

  test('no old cache is a no-op', () => {
    const fresh = freshScrape()
    expect(preserveEnrichment(null, fresh)).toEqual({ artists: 0, albums: 0 })
    expect(fresh.artists[0].albums[0].upc).toBeUndefined()
  })
})

describe('parseRfc4180 (catalog CSV)', () => {
  test('quoted commas do not shift columns', () => {
    const rows = parseRfc4180('id,title,upc\n42,"Title, Pt. 2",123\n')
    expect(rows[1]).toEqual(['42', 'Title, Pt. 2', '123'])
  })
})
