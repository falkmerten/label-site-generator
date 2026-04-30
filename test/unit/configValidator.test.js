'use strict'

const { validate } = require('../../src/configValidator')
const { CONFIG_SCHEMA } = require('../../src/configSchema')

describe('configValidator', () => {
  describe('valid configs', () => {
    it('accepts a minimal valid config', () => {
      const config = {
        site: {
          name: 'My Label',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://mylabel.bandcamp.com/'
        },
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
          template: null,
          source: 'bandcamp',
          sourceUrl: 'https://aenaos.bandcamp.com/'
        },
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
              soundcharts: null,
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
        compilations: ['various-artists'],
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
        site: {
          name: 'Test',
          url: null,
          mode: 'artist',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
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
        site: {
          name: 123,
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({
        path: 'site.name',
        message: 'Expected string, got number',
        expected: 'string',
        actual: 123
      })
    })

    it('reports wrong type for boolean field', () => {
      const config = {
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
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
        site: {
          name: 'Test',
          url: 42,
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toEqual({
        path: 'site.url',
        message: 'Expected string|null, got number',
        expected: 'string|null',
        actual: 42
      })
    })
  })

  describe('required fields', () => {
    it('reports missing required top-level fields', () => {
      const config = {}
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0].path).toBe('site')
      expect(result.errors[0].message).toBe('Missing required property: site')
      expect(result.errors[1].path).toBe('artists')
      expect(result.errors[1].message).toBe('Missing required property: artists')
    })

    it('reports missing required nested fields', () => {
      const config = {
        site: {
          name: 'Test'
        },
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      const paths = result.errors.map(e => e.path)
      expect(paths).toContain('site.mode')
      expect(paths).toContain('site.source')
      expect(paths).toContain('site.sourceUrl')
    })

    it('reports missing required field in additionalProperties', () => {
      const config = {
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
        artists: {
          'no-name-artist': {
            enabled: true
          }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('artists.no-name-artist.name')
    })
  })

  describe('enum validation', () => {
    it('reports invalid enum value', () => {
      const config = {
        site: {
          name: 'Test',
          mode: 'invalid-mode',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
        artists: {}
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('site.mode')
      expect(result.errors[0].message).toContain('must be one of')
    })
  })

  describe('array items validation', () => {
    it('reports invalid array item type', () => {
      const config = {
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
        artists: {},
        compilations: ['valid', 123, 'also-valid']
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].path).toBe('compilations[1]')
      expect(result.errors[0].expected).toBe('string')
    })
  })

  describe('additionalProperties validation', () => {
    it('validates all dynamic artist keys against the artist schema', () => {
      const config = {
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
        artists: {
          'artist-a': { name: 'A', enabled: true },
          'artist-b': { name: 'B', enabled: 'not-boolean' }
        }
      }
      const result = validate(config, CONFIG_SCHEMA)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].path).toBe('artists.artist-b.enabled')
    })
  })

  describe('nested object validation', () => {
    it('validates deeply nested link fields', () => {
      const config = {
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
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
        site: {
          name: 123,
          mode: 'invalid',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
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
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
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
        site: {
          name: 'Test',
          mode: 'label',
          source: 'bandcamp',
          sourceUrl: 'https://test.bandcamp.com/'
        },
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
      expect(result.errors[0].path).toBe('artists.test-artist.links.bandsintown.artistId')
    })
  })
})
