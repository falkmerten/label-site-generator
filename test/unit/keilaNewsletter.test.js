'use strict'

// Mock markdown.js to avoid ESM dependency chain (isomorphic-dompurify/jsdom)
jest.mock('../../src/markdown', () => ({ renderMarkdown: (md) => md }))

const http = require('http')
const https = require('https')
const { resolveNewsletter } = require('../../src/renderer')
const { createKeilaCampaign, postRequest } = require('../../src/newsletterCampaign')
const nunjucks = require('nunjucks')
const path = require('path')

// ---------------------------------------------------------------------------
// Mock http/https.request to prevent real network calls
// ---------------------------------------------------------------------------
let lastRequestOpts = null
let lastRequestData = null

function createMockReqRes (cb) {
  const { EventEmitter } = require('events')
  const res = new EventEmitter()
  res.statusCode = 200
  process.nextTick(() => {
    cb(res)
    process.nextTick(() => {
      res.emit('data', '{}')
      res.emit('end')
    })
  })
  const req = new EventEmitter()
  req.write = (d) => { lastRequestData = d }
  req.end = () => {}
  return req
}

const origHttpRequest = http.request
const origHttpsRequest = https.request
http.request = function (opts, cb) { lastRequestOpts = opts; return createMockReqRes(cb) }
https.request = function (opts, cb) { lastRequestOpts = opts; return createMockReqRes(cb) }

afterAll(() => {
  http.request = origHttpRequest
  https.request = origHttpsRequest
})

// ---------------------------------------------------------------------------
// Env var helpers
// ---------------------------------------------------------------------------
let savedEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  lastRequestOpts = null
  lastRequestData = null
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  process.env = savedEnv
  console.warn.mockRestore()
})

// ---------------------------------------------------------------------------
// Test: Keila provider exists in NEWSLETTER_PROVIDERS map
// Validates: Requirement 1.1
// ---------------------------------------------------------------------------
describe('Keila provider registration', () => {
  test('keila provider exists in NEWSLETTER_PROVIDERS', () => {
    process.env.NEWSLETTER_PROVIDER = 'keila'
    process.env.NEWSLETTER_ACTION_URL = 'https://keila.example.com'
    process.env.NEWSLETTER_KEILA_FORM_ID = 'nfrm_test123'

    const result = resolveNewsletter()
    expect(result.provider).toBe('keila')
  })

  test('required env vars list is NEWSLETTER_ACTION_URL and NEWSLETTER_KEILA_FORM_ID', () => {
    // Missing NEWSLETTER_ACTION_URL
    process.env.NEWSLETTER_PROVIDER = 'keila'
    delete process.env.NEWSLETTER_ACTION_URL
    process.env.NEWSLETTER_KEILA_FORM_ID = 'nfrm_test123'

    let result = resolveNewsletter()
    expect(result.provider).toBe('')

    // Missing NEWSLETTER_KEILA_FORM_ID
    process.env.NEWSLETTER_ACTION_URL = 'https://keila.example.com'
    delete process.env.NEWSLETTER_KEILA_FORM_ID

    result = resolveNewsletter()
    expect(result.provider).toBe('')

    // Both present → valid
    process.env.NEWSLETTER_KEILA_FORM_ID = 'nfrm_test123'
    result = resolveNewsletter()
    expect(result.provider).toBe('keila')
  })
})

// ---------------------------------------------------------------------------
// Test: Keila campaign uses /api/v1/campaigns URL
// Validates: Requirement 3.6 (draft only, not /actions/send)
// ---------------------------------------------------------------------------
describe('Keila campaign creation', () => {
  test('campaign URL is /api/v1/campaigns', async () => {
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost:4000'
    process.env.NEWSLETTER_API_TOKEN = 'test-api-token'
    process.env.NEWSLETTER_KEILA_SENDER_ID = 'nms_sender1'

    const article = { title: 'Test Article', excerpt: 'Test excerpt', slug: 'test-article' }
    await createKeilaCampaign(article, 'plain text content')

    expect(lastRequestOpts.path).toBe('/api/v1/campaigns')
    // Verify it does NOT use /actions/send or /actions/schedule
    expect(lastRequestOpts.path).not.toContain('/actions/send')
    expect(lastRequestOpts.path).not.toContain('/actions/schedule')
  })

  test('campaign sends Bearer auth from NEWSLETTER_API_TOKEN', async () => {
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost:4000'
    process.env.NEWSLETTER_API_TOKEN = 'my-secret-token'
    process.env.NEWSLETTER_KEILA_SENDER_ID = 'nms_sender1'

    const article = { title: 'Test', excerpt: 'Excerpt', slug: 'test' }
    await createKeilaCampaign(article, 'plain text')

    expect(lastRequestOpts.headers.Authorization).toBe('Bearer my-secret-token')
  })

  test('campaign body has correct Keila structure', async () => {
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost:4000'
    process.env.NEWSLETTER_API_TOKEN = 'token123'
    process.env.NEWSLETTER_KEILA_SENDER_ID = 'nms_abc'

    const article = { title: 'New Release', excerpt: 'Check out our latest album', slug: 'new-release' }
    const plainText = 'New Release\n\nCheck out our latest album\n\nRead more: http://example.com/news/new-release/'
    await createKeilaCampaign(article, plainText)

    const body = JSON.parse(lastRequestData)
    expect(body.data).toBeDefined()
    expect(body.data.subject).toBe('New Release')
    expect(body.data.text_body).toContain('Check out our latest album')
    expect(body.data.settings).toEqual({ type: 'markdown' })
    expect(body.data.sender_id).toBe('nms_abc')
  })
})

// ---------------------------------------------------------------------------
// Test: Bearer auth in postRequest
// Validates: Requirement 4.2
// ---------------------------------------------------------------------------
describe('postRequest Bearer auth', () => {
  test('Bearer token is used when provided', async () => {
    await postRequest('http://localhost:4000/api/test', '{}', 'json', null, null, 'bearer-token-123')

    expect(lastRequestOpts.headers.Authorization).toBe('Bearer bearer-token-123')
  })

  test('Basic auth is used when no bearer token', async () => {
    await postRequest('http://localhost:4000/api/test', '{}', 'json', 'user', 'pass')

    expect(lastRequestOpts.headers.Authorization).toBe('Basic ' + Buffer.from('user:pass').toString('base64'))
  })

  test('Bearer takes precedence over basic auth', async () => {
    await postRequest('http://localhost:4000/api/test', '{}', 'json', 'user', 'pass', 'bearer-wins')

    expect(lastRequestOpts.headers.Authorization).toBe('Bearer bearer-wins')
  })
})

// ---------------------------------------------------------------------------
// Test: Template renders keila signup block
// Validates: Requirements 2.1, 2.4, 2.5
// ---------------------------------------------------------------------------
describe('Keila template rendering', () => {
  let env

  beforeAll(() => {
    const labelDir = path.join(__dirname, '..', '..', 'templates', 'label')
    const sharedDir = path.join(__dirname, '..', '..', 'templates', 'shared')
    env = nunjucks.configure([labelDir, sharedDir], { autoescape: true })
    env.addFilter('isLocal', (url) => url && !url.startsWith('http'))
    env.addFilter('toWebp', (url) => url ? url.replace(/\.(jpg|jpeg|png)$/i, '.webp') : url)
    env.addFilter('toMobileWebp', (url) => url ? url.replace(/\.(jpg|jpeg|png)$/i, '-mobile.webp') : url)
    env.addFilter('urlencode', (str) => encodeURIComponent(str || ''))
    env.addFilter('availableFormats', () => 'Digital')
    env.addFilter('youtubeId', () => '')
    env.addFilter('nl2br', (str) => str || '')
    env.addFilter('formatDate', (iso) => iso || '')
    env.addFilter('isFuture', () => false)
    env.addFilter('storeUrl', (t) => t || '')
    env.addFilter('extraStoreSearchUrl', () => '#')
  })

  test('template renders keila signup block with contact[email] and honeypot', () => {
    const html = nunjucks.render('index.njk', {
      artists: [],
      labelName: 'Test Label',
      siteUrl: 'https://example.com/',
      gaMeasurementId: '',
      physicalStores: [],
      customStoreDefs: {},
      extraStores: [],
      currentYear: 2025,
      newsletter: {
        provider: 'keila',
        actionUrl: 'https://keila.example.com',
        formId: 'nfrm_test123',
        formUrl: 'https://keila.example.com/forms/nfrm_test123'
      },
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
      rootPath: './',
      canonicalUrl: 'https://example.com/'
    })

    // Keila block should be rendered (contains keila-specific JS handler)
    expect(html).toContain("contact[email]")

    // Should contain honeypot field h[url]
    expect(html).toContain("h[url]")

    // Should POST to the form URL with form-urlencoded content type
    expect(html).toContain('application/x-www-form-urlencoded')

    // Should contain the action URL and form ID in the fetch URL
    expect(html).toContain('keila.example.com/forms/nfrm_test123')

    // Should show success message
    expect(html).toContain('Almost there')

    // Should NOT contain sendy or listmonk specific code
    expect(html).not.toContain('api_key')
    expect(html).not.toContain('list_uuids')
  })
})
