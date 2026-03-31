const { toSlug } = require('../../src/slugs')

describe('toSlug', () => {
  // Empty / null / undefined inputs
  test('returns empty string for empty string', () => {
    expect(toSlug('')).toBe('')
  })

  test('returns empty string for null', () => {
    expect(toSlug(null)).toBe('')
  })

  test('returns empty string for undefined', () => {
    expect(toSlug(undefined)).toBe('')
  })

  // Basic conversion
  test('lowercases the input', () => {
    expect(toSlug('Hello World')).toBe('hello-world')
  })

  test('replaces spaces with hyphens', () => {
    expect(toSlug('foo bar')).toBe('foo-bar')
  })

  test('replaces special characters with hyphens', () => {
    expect(toSlug('foo!@#bar')).toBe('foo-bar')
  })

  test('collapses consecutive hyphens', () => {
    expect(toSlug('foo---bar')).toBe('foo-bar')
  })

  test('collapses consecutive special characters into a single hyphen', () => {
    expect(toSlug('foo  bar')).toBe('foo-bar')
  })

  test('trims leading hyphens', () => {
    expect(toSlug('---foo')).toBe('foo')
  })

  test('trims trailing hyphens', () => {
    expect(toSlug('foo---')).toBe('foo')
  })

  test('trims both leading and trailing hyphens', () => {
    expect(toSlug('---foo---')).toBe('foo')
  })

  // All-special-characters input
  test('returns empty string for all-special-characters input', () => {
    expect(toSlug('!@#$%^&*()')).toBe('')
  })

  // Already-valid slug
  test('leaves an already-valid slug unchanged', () => {
    expect(toSlug('already-valid-slug')).toBe('already-valid-slug')
  })

  // Very long name
  test('handles a very long name', () => {
    const long = 'a'.repeat(1000)
    expect(toSlug(long)).toBe('a'.repeat(1000))
  })

  // Unicode names
  test('replaces Unicode characters with hyphens', () => {
    expect(toSlug('Æneas Records')).toBe('neas-records')
  })

  test('handles mixed ASCII and Unicode', () => {
    const result = toSlug('Björk')
    // Non-ASCII chars become hyphens, then collapsed/trimmed
    expect(result).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$|^$/)
  })

  // Numbers
  test('preserves numbers in the slug', () => {
    expect(toSlug('Album 2024')).toBe('album-2024')
  })
})

const { assignSlugs } = require('../../src/slugs')

describe('assignSlugs', () => {
  test('adds slug to each artist from their name', () => {
    const result = assignSlugs([{ name: 'Hello World', albums: [] }])
    expect(result[0].slug).toBe('hello-world')
  })

  test('adds slug to each album from its title', () => {
    const result = assignSlugs([{ name: 'Artist', albums: [{ title: 'My Album' }] }])
    expect(result[0].albums[0].slug).toBe('my-album')
  })

  test('resolves artist slug collisions with -2, -3 suffix', () => {
    const artists = [
      { name: 'Same Name', albums: [] },
      { name: 'Same Name', albums: [] },
      { name: 'Same Name', albums: [] }
    ]
    const result = assignSlugs(artists)
    expect(result[0].slug).toBe('same-name')
    expect(result[1].slug).toBe('same-name-2')
    expect(result[2].slug).toBe('same-name-3')
  })

  test('resolves album slug collisions within the same artist', () => {
    const artists = [
      {
        name: 'Artist',
        albums: [
          { title: 'Same Title' },
          { title: 'Same Title' },
          { title: 'Same Title' }
        ]
      }
    ]
    const result = assignSlugs(artists)
    const albums = result[0].albums
    expect(albums[0].slug).toBe('same-title')
    expect(albums[1].slug).toBe('same-title-2')
    expect(albums[2].slug).toBe('same-title-3')
  })

  test('album slug collisions are scoped per artist, not global', () => {
    const artists = [
      { name: 'Artist One', albums: [{ title: 'Same Title' }] },
      { name: 'Artist Two', albums: [{ title: 'Same Title' }] }
    ]
    const result = assignSlugs(artists)
    expect(result[0].albums[0].slug).toBe('same-title')
    expect(result[1].albums[0].slug).toBe('same-title')
  })

  test('does not mutate original artist objects', () => {
    const original = { name: 'Artist', albums: [{ title: 'Album' }] }
    assignSlugs([original])
    expect(original.slug).toBeUndefined()
    expect(original.albums[0].slug).toBeUndefined()
  })

  test('handles empty artists array', () => {
    expect(assignSlugs([])).toEqual([])
  })

  test('handles artist with no albums', () => {
    const result = assignSlugs([{ name: 'Solo', albums: [] }])
    expect(result[0].slug).toBe('solo')
    expect(result[0].albums).toEqual([])
  })
})
