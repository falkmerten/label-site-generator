
const { validate } = require('../../src/configValidator')
const { CONFIG_SCHEMA } = require('../../src/configSchema')

// Shared minimal valid building blocks for the current schema:
// top-level required = site, source, artists.
// `source` is a top-level object ({ primary, ... }); `site` requires name + mode.
const validSite = { name: 'Test', mode: 'label' }
const validSource = { primary: 'bandcamp', url: 'https://test.bandcamp.com/' }

describe('configValidator', () => {
  describe('valid configs', () => {
    it('accepts a minimal valid config', () => {
      const config = {
        site: { name: 'My Label', mode: 'label' },
        source: { primary: 'bandcamp', url: 'https://mylabel.bandcamp.com/' },
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('accepts a full valid config with artists and links', () => {
      const config = {
        site: {
          name: 'Aenaos Records',
          url: 'https://aenaos.com/',
          mode: 'label',
          theme: 'standard',
          template: null
        },
        source: { primary: 'bandcamp', url: 'https://aenaos.bandcamp.com/' },
        artists: {
          'golden-apes': {
            name: 'Golden Apes',
            enabled: true,
            source: 'bandcamp',
            exclude: false,
            excludeAlbums: ['some-album'],
            bandcampUrl: null,
            links: {
              spotify: 'https://open.spotify.com/artist/123',
              bandcamp: 'https://goldenapes.bandcamp.com/',
              youtube: null,
              instagram: null,
              facebook: null,
              website: null,
              tiktok: null,
              twitter: null,
              bandsintown: null
            }
          }
        },
        compilations: {
          'various-artists': {
            'some-compilation': 'https://open.spotify.com/album/123'
          }
        },
        newsletter: {
          provider: 'keila',
          actionUrl: 'https://news.aenaos.com',
          formId: 'abc123',
          listId: null
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('accepts string or null for url fields', () => {
      const config = {
        site: { name: 'Test', url: null, mode: 'artist' },
        source: validSource,
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('type validation', () => {
    it('reports wrong type for string field', () => {
      const config = {
        site: { name: 123, mode: 'label' },
        source: validSource,
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'site.name' && e.expected === 'string')).toBe(true)
    })

    it('reports wrong type for boolean field', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'test-artist': {
            name: 'Test',
            enabled: 'yes'
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'artists.test-artist.enabled')).toBe(true)
    })

    it('reports wrong type for array of types (string|null)', () => {
      const config = {
        site: { name: 'Test', url: 42, mode: 'label' },
        source: validSource,
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'site.url' && e.expected === 'string|null')).toBe(true)
    })
  })

  describe('required fields', () => {
    it('reports missing required top-level fields', () => {
      const config = {}
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const paths = result.errors.map(e => e.path)
      expect(paths).toContain('site')
      expect(paths).toContain('source')
      expect(paths).toContain('artists')
    })

    it('reports missing required nested fields', () => {
      const config = {
        site: { name: 'Test' },
        source: validSource,
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const paths = result.errors.map(e => e.path)
      expect(paths).toContain('site.mode')
    })

    it('reports missing required primary in source', () => {
      const config = {
        site: validSite,
        source: { url: 'https://test.bandcamp.com/' },
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const paths = result.errors.map(e => e.path)
      expect(paths).toContain('source.primary')
    })

    it('reports missing required field in additionalProperties', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'no-name-artist': {
            enabled: true
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'artists.no-name-artist.name')).toBe(true)
    })
  })

  describe('enum validation', () => {
    it('reports invalid enum value', () => {
      const config = {
        site: { name: 'Test', mode: 'invalid-mode' },
        source: validSource,
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const modeError = result.errors.find(e => e.path === 'site.mode')
      expect(modeError).toBeDefined()
      expect(modeError.message).toContain('must be one of')
    })
  })

  describe('array items validation', () => {
    it('reports invalid array item type', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'test-artist': {
            name: 'Test',
            excludeAlbums: ['valid', 123, 'also-valid']
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const err = result.errors.find(e => e.path === 'artists.test-artist.excludeAlbums[1]')
      expect(err).toBeDefined()
      expect(err.expected).toBe('string')
    })
  })

  describe('additionalProperties validation', () => {
    it('validates all dynamic artist keys against the artist schema', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'artist-a': { name: 'A', enabled: true },
          'artist-b': { name: 'B', enabled: 'not-boolean' }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'artists.artist-b.enabled')).toBe(true)
      // artist-a is fully valid, so it contributes no errors
      expect(result.errors.some(e => e.path.startsWith('artists.artist-a'))).toBe(false)
    })
  })

  describe('nested object validation', () => {
    it('validates deeply nested link fields', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'golden-apes': {
            name: 'Golden Apes',
            links: {
              spotify: 42,
              youtube: true
            }
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const paths = result.errors.map(e => e.path)
      expect(paths).toContain('artists.golden-apes.links.spotify')
      expect(paths).toContain('artists.golden-apes.links.youtube')
    })
  })

  describe('multiple errors', () => {
    it('collects all errors without stopping at first', () => {
      const config = {
        site: { name: 123, mode: 'invalid' },
        source: validSource,
        artists: {
          'bad-artist': {
            name: 456,
            enabled: 'yes'
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('pattern validation', () => {
    it('validates string against pattern', () => {
      const schema = {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            pattern: '^https://[a-z0-9-]+\\.bandcamp\\.com/?$'
          }
        }
      }
      const invalid = { url: 'http://not-bandcamp.com' }
      const result = validate(invalid, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('url')
      expect(result.errors[0].message).toContain('does not match pattern')
    })

    it('passes valid pattern', () => {
      const schema = {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            pattern: '^https://[a-z0-9-]+\\.bandcamp\\.com/?$'
          }
        }
      }
      const valid = { url: 'https://aenaos.bandcamp.com/' }
      const result = validate(valid, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles null value at top level', () => {
      const result = validate(null, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors[0].expected).toBe('object')
    })

    it('handles empty schema gracefully', () => {
      const result = validate({ anything: 'goes' }, {})
      expect(result.valid).toBe(true)
    })

    it('handles bandsintown nested object-or-null', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'test-artist': {
            name: 'Test',
            links: {
              bandsintown: { appId: 'abc', artistId: '123' }
            }
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(true)
    })

    it('rejects bandsintown with missing required fields', () => {
      const config = {
        site: validSite,
        source: validSource,
        artists: {
          'test-artist': {
            name: 'Test',
            links: {
              bandsintown: { appId: 'abc' }
            }
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'artists.test-artist.links.bandsintown.artistId')).toBe(true)
    })
  })
})
