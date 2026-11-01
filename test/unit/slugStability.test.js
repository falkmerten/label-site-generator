'use strict'

const { assignSlugs } = require('../../src/slugs')
const { classifyReleaseType } = require('../../src/releaseType')
const { findExistingAlbum, preserveEnrichment } = require('../../src/refreshArtist')

const tracks = (n, dur = '3:00') => Array.from({ length: n }, (_, i) => ({ name: `T${i + 1}`, duration: dur }))
const slugsOf = (artists) => artists[0].albums.map(a => a.slug)

describe('classifyReleaseType', () => {
  test('track count and duration', () => {
    expect(classifyReleaseType({ tracks: tracks(2) })).toBe('single')
    expect(classifyReleaseType({ tracks: tracks(5) })).toBe('ep')
    expect(classifyReleaseType({ tracks: tracks(8) })).toBe('album')
    expect(classifyReleaseType({ tracks: tracks(5, '7:00') })).toBe('album') // 35 min: duration wins
    expect(classifyReleaseType({ tracks: [] })).toBe('album')
  })

  test('Bandcamp /track/ URL is a single', () => {
    expect(classifyReleaseType({ url: 'https://x.bandcamp.com/track/foo', tracks: [] })).toBe('single')
  })

  test('falls back to raw.trackinfo count', () => {
    expect(classifyReleaseType({ raw: { trackinfo: [{ duration: 200 }, { duration: 200 }] } })).toBe('single')
  })
})

describe('assignSlugs', () => {
  test('keeps an established slug when the title changes', () => {
    const out = assignSlugs([{ name: 'A', albums: [{ title: 'Renamed Title', slug: 'original-title' }] }])
    expect(slugsOf(out)).toEqual(['original-title'])
  })

  test('keeps established -2 slugs (no URL changes for existing pages)', () => {
    const out = assignSlugs([{ name: 'A', albums: [
      { title: 'Foo', slug: 'foo', tracks: tracks(10) },
      { title: 'Foo', slug: 'foo-2', tracks: tracks(5) }
    ] }])
    expect(slugsOf(out)).toEqual(['foo', 'foo-2'])
  })

  test('new same-title releases: result does not depend on list order', () => {
    const album = { title: 'Foo', url: 'https://x.bandcamp.com/album/foo', tracks: tracks(10) }
    const ep = { title: 'Foo', url: 'https://x.bandcamp.com/album/foo-2', tracks: tracks(5) }
    const single = { title: 'Foo', url: 'https://x.bandcamp.com/track/foo', tracks: tracks(1) }

    const a = assignSlugs([{ name: 'A', albums: [album, ep, single] }])[0].albums
    const b = assignSlugs([{ name: 'A', albums: [single, ep, album] }])[0].albums
    const bySlug = (list) => Object.fromEntries(list.map(x => [x.url, x.slug]))
    expect(bySlug(a)).toEqual(bySlug(b))
    expect(bySlug(a)).toEqual({
      'https://x.bandcamp.com/album/foo': 'foo',
      'https://x.bandcamp.com/album/foo-2': 'foo-ep',
      'https://x.bandcamp.com/track/foo': 'foo-single'
    })
  })

  test('a new release never takes an established slug', () => {
    const out = assignSlugs([{ name: 'A', albums: [
      { title: 'Foo', url: 'https://x.bandcamp.com/track/foo', tracks: tracks(1) },
      { title: 'Foo', slug: 'foo', tracks: tracks(10) }
    ] }])
    expect(slugsOf(out)).toEqual(['foo-single', 'foo'])
  })

  test('an album colliding with an album gets a numeric suffix, not -single', () => {
    const out = assignSlugs([{ name: 'A', albums: [
      { title: 'Foo', tracks: tracks(10), releaseDate: '2020-01-01' },
      { title: 'Foo', tracks: tracks(10), releaseDate: '2022-01-01' }
    ] }])
    expect(slugsOf(out)).toEqual(['foo', 'foo-2'])
  })

  test('does not mutate the input', () => {
    const input = [{ name: 'A', albums: [{ title: 'Foo' }] }]
    assignSlugs(input)
    expect(input[0].albums[0].slug).toBeUndefined()
  })
})

describe('findExistingAlbum', () => {
  const cached = [
    { title: 'Old Title', url: 'https://x.bandcamp.com/album/old-title', slug: 'old-title', raw: { current: { id: 111 } }, upc: '0001' },
    { title: 'Other', url: 'https://x.bandcamp.com/album/other', slug: 'other', raw: { current: { id: 222 } } },
    { title: 'Coming Soon', slug: 'coming-soon' }
  ]

  test('matches by Bandcamp id even when URL and title changed', () => {
    const scraped = { title: 'New Title', url: 'https://x.bandcamp.com/album/new-title', raw: { current: { id: 111 } } }
    expect(findExistingAlbum(cached, scraped)).toBe(cached[0])
  })

  test('matches by UPC when id and URL differ', () => {
    const scraped = { title: 'X', url: 'https://x.bandcamp.com/album/x', raw: { current: { id: 999, upc: '0001' } } }
    expect(findExistingAlbum(cached, scraped)).toBe(cached[0])
  })

  test('matches an upcoming entry by title', () => {
    const scraped = { title: 'Coming Soon!', url: 'https://x.bandcamp.com/album/coming-soon-live' }
    expect(findExistingAlbum(cached, scraped)).toBe(cached[2])
  })

  test('full re-scrape keeps the slug when Bandcamp renamed the album', () => {
    const oldData = { artists: [{ name: 'A', url: 'https://x.bandcamp.com', albums: [cached[0]] }] }
    const fresh = { artists: [{ name: 'A', url: 'https://x.bandcamp.com', albums: [
      { title: 'New Title', url: 'https://x.bandcamp.com/album/new-title', raw: { current: { id: 111 } } }
    ] }] }
    preserveEnrichment(oldData, fresh)
    const out = assignSlugs(fresh.artists)
    expect(out[0].albums[0].slug).toBe('old-title')
    expect(out[0].albums[0].upc).toBe('0001')
  })
})
