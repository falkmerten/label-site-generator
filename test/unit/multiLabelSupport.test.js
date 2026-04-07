'use strict'

const nunjucks = require('nunjucks')
const { buildLabelData } = require('../../src/discogs')

// ---------------------------------------------------------------------------
// Nunjucks template setup (matches real renderer: autoescape enabled)
// ---------------------------------------------------------------------------
const env = new nunjucks.Environment(null, { autoescape: true })

const labelTemplate = '{% if album.labelName %}{% set labelParts = album.labelName.split(\' / \') %}{% for part in labelParts %}{% if album.labelUrls and album.labelUrls[loop.index0] %}<a href="{{ album.labelUrls[loop.index0] }}" target="_blank" rel="noopener noreferrer">{{ part }}</a>{% else %}{{ part }}{% endif %}{% if not loop.last %} / {% endif %}{% endfor %}{% endif %}'

const discogsLabelTemplate = '{% if album.discogsLabel and album.discogsLabel != album.labelName %}{% set discogsParts = album.discogsLabel.split(\' / \') %}{% for dpart in discogsParts %}{% if dpart != album.labelName %} / {% if album.discogsLabelUrls and album.discogsLabelUrls[loop.index0] %}<a href="{{ album.discogsLabelUrls[loop.index0] }}" target="_blank" rel="noopener noreferrer">{{ dpart }}</a>{% else %}{{ dpart }}{% endif %}{% endif %}{% endfor %}{% endif %}'

// ---------------------------------------------------------------------------
// Merger normalization logic (extracted from src/merger.js)
// ---------------------------------------------------------------------------
function normalizeLabelUrls (album) {
  return album.labelUrls || (album.labelUrl
    ? [album.labelUrl, ...Array(
        Math.max(0, (album.labelName || '').split(' / ').length - 1)
      ).fill(null)]
    : null)
}

// ===========================================================================
// Template rendering tests
// Validates: Requirements 2.3, 2.4, 8.3
// ===========================================================================
describe('Template rendering: multi-label support', () => {
  test('single label with URL renders as one link', () => {
    const album = {
      labelName: 'Aenaos Records',
      labelUrls: ['https://www.discogs.com/label/1648817']
    }
    const rendered = env.renderString(labelTemplate, { album })

    expect(rendered).toContain('<a href="https://www.discogs.com/label/1648817" target="_blank" rel="noopener noreferrer">Aenaos Records</a>')
    expect(rendered).not.toContain(' / ')
  })

  test('three labels, middle one has null URL, renders as link / text / link', () => {
    const album = {
      labelName: 'Label A / Label B / Label C',
      labelUrls: [
        'https://www.discogs.com/label/111',
        null,
        'https://www.discogs.com/label/333'
      ]
    }
    const rendered = env.renderString(labelTemplate, { album })

    expect(rendered).toContain('<a href="https://www.discogs.com/label/111" target="_blank" rel="noopener noreferrer">Label A</a>')
    expect(rendered).toContain('Label B')
    expect(rendered).not.toContain('<a href="https://www.discogs.com/label/111" target="_blank" rel="noopener noreferrer">Label B</a>')
    expect(rendered).not.toMatch(/<a [^>]*>Label B<\/a>/)
    expect(rendered).toContain('<a href="https://www.discogs.com/label/333" target="_blank" rel="noopener noreferrer">Label C</a>')
    // Verify separator between labels
    expect((rendered.match(/ \/ /g) || []).length).toBe(2)
  })

  test('empty labelName renders nothing', () => {
    const album = {
      labelName: '',
      labelUrls: []
    }
    const rendered = env.renderString(labelTemplate, { album })

    expect(rendered.trim()).toBe('')
  })

  test('null labelName renders nothing', () => {
    const album = {
      labelName: null,
      labelUrls: null
    }
    const rendered = env.renderString(labelTemplate, { album })

    expect(rendered.trim()).toBe('')
  })
})

// ===========================================================================
// Merger normalization tests
// Validates: Requirements 1.4, 7.1, 7.3, 8.1, 8.2
// ===========================================================================
describe('Merger normalization: backward compatibility', () => {
  test('old cache entry with labelUrl string and 3-label labelName produces [url, null, null]', () => {
    const album = {
      labelName: 'Label A / Label B / Label C',
      labelUrl: 'https://www.discogs.com/label/100',
      labelUrls: undefined
    }
    const result = normalizeLabelUrls(album)

    expect(result).toEqual([
      'https://www.discogs.com/label/100',
      null,
      null
    ])
  })

  test('new cache entry with labelUrls array passes through unchanged', () => {
    const urls = [
      'https://www.discogs.com/label/100',
      'https://www.discogs.com/label/200',
      'https://www.discogs.com/label/300'
    ]
    const album = {
      labelName: 'Label A / Label B / Label C',
      labelUrl: 'https://www.discogs.com/label/100',
      labelUrls: urls
    }
    const result = normalizeLabelUrls(album)

    expect(result).toBe(urls) // same reference — passthrough
  })

  test('labelName with single label (no /) produces single-element array', () => {
    const album = {
      labelName: 'Solo Records',
      labelUrl: 'https://www.discogs.com/label/42',
      labelUrls: undefined
    }
    const result = normalizeLabelUrls(album)

    expect(result).toEqual(['https://www.discogs.com/label/42'])
  })

  test('no labelUrl and no labelUrls returns null', () => {
    const album = {
      labelName: 'Some Label',
      labelUrl: undefined,
      labelUrls: undefined
    }
    const result = normalizeLabelUrls(album)

    expect(result).toBeNull()
  })
})

// ===========================================================================
// Discogs label linking tests (LSG-50)
// Validates: discogsLabel rendered with URLs, duplicates filtered
// ===========================================================================
describe('Template rendering: discogsLabel linking', () => {
  test('single discogsLabel with URL renders as linked', () => {
    const album = {
      labelName: 'Aenaos Records',
      labelUrls: null,
      discogsLabel: 'Icy Cold Records',
      discogsLabelUrls: ['https://www.discogs.com/label/555']
    }
    const rendered = env.renderString(discogsLabelTemplate, { album })

    expect(rendered).toContain('<a href="https://www.discogs.com/label/555" target="_blank" rel="noopener noreferrer">Icy Cold Records</a>')
  })

  test('multi-label discogsLabel filters out duplicate of labelName and links the rest', () => {
    // (((S))) Black Dog case: labelName=Aenaos Records, discogsLabel=Label A / Label B / Label C
    const album = {
      labelName: 'Aenaos Records',
      labelUrls: ['https://www.discogs.com/label/1648817'],
      discogsLabel: 'Label A / Label B / Label C',
      discogsLabelUrls: [
        'https://www.discogs.com/label/1648817',
        'https://www.discogs.com/label/222',
        'https://www.discogs.com/label/333'
      ]
    }
    const rendered = env.renderString(discogsLabelTemplate, { album })

    // Label A should be filtered out (already in labelName)
    expect(rendered).not.toMatch(/>Aenaos Records</)
    // Label B and Label C should be linked
    expect(rendered).toContain('<a href="https://www.discogs.com/label/222" target="_blank" rel="noopener noreferrer">Label B</a>')
    expect(rendered).toContain('<a href="https://www.discogs.com/label/333" target="_blank" rel="noopener noreferrer">Label C</a>')
  })

  test('discogsLabel with null URL renders as plain text', () => {
    const album = {
      labelName: 'Spotify Label',
      discogsLabel: 'Some Discogs Label',
      discogsLabelUrls: [null]
    }
    const rendered = env.renderString(discogsLabelTemplate, { album })

    expect(rendered).toContain('Some Discogs Label')
    expect(rendered).not.toMatch(/<a [^>]*>Some Discogs Label<\/a>/)
  })

  test('no discogsLabel renders nothing', () => {
    const album = {
      labelName: 'Aenaos Records',
      discogsLabel: null,
      discogsLabelUrls: null
    }
    const rendered = env.renderString(discogsLabelTemplate, { album })

    expect(rendered.trim()).toBe('')
  })

  test('discogsLabel same as labelName renders nothing', () => {
    const album = {
      labelName: 'Aenaos Records',
      discogsLabel: 'Aenaos Records',
      discogsLabelUrls: ['https://www.discogs.com/label/1648817']
    }
    const rendered = env.renderString(discogsLabelTemplate, { album })

    expect(rendered.trim()).toBe('')
  })

  test('discogsLabel without discogsLabelUrls renders as plain text', () => {
    // Backward compatibility: old cache entries without discogsLabelUrls
    const album = {
      labelName: 'Spotify Label',
      discogsLabel: 'Icy Cold Records',
      discogsLabelUrls: undefined
    }
    const rendered = env.renderString(discogsLabelTemplate, { album })

    expect(rendered).toContain('Icy Cold Records')
    expect(rendered).not.toMatch(/<a [^>]*>Icy Cold Records<\/a>/)
  })
})
