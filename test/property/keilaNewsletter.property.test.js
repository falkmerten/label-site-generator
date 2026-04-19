'use strict'

// Mock markdown.js to avoid ESM dependency chain (isomorphic-dompurify/jsdom)
jest.mock('../../src/markdown', () => ({ renderMarkdown: (md) => md }))

const fc = require('fast-check')
const http = require('http')
const https = require('https')
const { resolveNewsletter } = require('../../src/renderer')
const { createKeilaCampaign, postRequest } = require('../../src/newsletterCampaign')

// Shared capture state for http/https request interception
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

// Patch http.request and https.request globally for the test file
const origHttpRequest = http.request
const origHttpsRequest = https.request

http.request = function (opts, cb) {
  lastRequestOpts = opts
  return createMockReqRes(cb)
}
https.request = function (opts, cb) {
  lastRequestOpts = opts
  return createMockReqRes(cb)
}

afterAll(() => {
  http.request = origHttpRequest
  https.request = origHttpsRequest
})

// ---------------------------------------------------------------------------
// Property 1: Missing required env vars → disabled config
// Feature: keila-newsletter-integration, Property 1: Missing required env vars disable newsletter
// **Validates: Requirements 1.3**
// ---------------------------------------------------------------------------

describe('Property 1: Missing required env vars disable newsletter', () => {
  const REQUIRED_VARS = ['NEWSLETTER_ACTION_URL', 'NEWSLETTER_KEILA_FORM_ID']

  let savedEnv
  beforeEach(() => {
    savedEnv = { ...process.env }
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    process.env = savedEnv
    console.warn.mockRestore()
  })

  test('any subset with at least one missing required var returns disabled config', () => {
    const subsetArb = fc.subarray(REQUIRED_VARS, { minLength: 0, maxLength: REQUIRED_VARS.length - 1 })
    const valueArb = fc.string({ minLength: 1, maxLength: 50 })

    fc.assert(
      fc.property(subsetArb, valueArb, (presentVars, value) => {
        delete process.env.NEWSLETTER_PROVIDER
        delete process.env.NEWSLETTER_ACTION_URL
        delete process.env.NEWSLETTER_KEILA_FORM_ID
        process.env.NEWSLETTER_PROVIDER = 'keila'
        for (const v of presentVars) { process.env[v] = value }

        const result = resolveNewsletter()
        return result.provider === '' && result.actionUrl === ''
      }),
      { numRuns: 100 }
    )
  })

  test('empty string values for required vars also produce disabled config', () => {
    const whichVarArb = fc.constantFrom(...REQUIRED_VARS)
    const valueArb = fc.string({ minLength: 1, maxLength: 50 })

    fc.assert(
      fc.property(whichVarArb, valueArb, (emptyVar, value) => {
        delete process.env.NEWSLETTER_PROVIDER
        delete process.env.NEWSLETTER_ACTION_URL
        delete process.env.NEWSLETTER_KEILA_FORM_ID
        process.env.NEWSLETTER_PROVIDER = 'keila'
        for (const v of REQUIRED_VARS) { process.env[v] = value }
        process.env[emptyVar] = ''

        const result = resolveNewsletter()
        return result.provider === '' && result.actionUrl === ''
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 2: Valid env vars produce correct config with derived formUrl
// Feature: keila-newsletter-integration, Property 2: Valid env vars → correct config with formUrl derivation
// **Validates: Requirements 1.4**
// ---------------------------------------------------------------------------

describe('Property 2: Valid env vars produce correct config with derived formUrl', () => {
  let savedEnv
  beforeEach(() => { savedEnv = { ...process.env } })
  afterEach(() => { process.env = savedEnv })

  test('non-empty actionUrl and formId produce correct config with formUrl derivation', () => {
    const actionUrlArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0)
    const formIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)

    fc.assert(
      fc.property(actionUrlArb, formIdArb, (actionUrl, formId) => {
        delete process.env.NEWSLETTER_PROVIDER
        delete process.env.NEWSLETTER_ACTION_URL
        delete process.env.NEWSLETTER_KEILA_FORM_ID
        process.env.NEWSLETTER_PROVIDER = 'keila'
        process.env.NEWSLETTER_ACTION_URL = actionUrl
        process.env.NEWSLETTER_KEILA_FORM_ID = formId

        const result = resolveNewsletter()
        return (
          result.provider === 'keila' &&
          result.actionUrl === actionUrl &&
          result.formId === formId &&
          result.formUrl === actionUrl + '/forms/' + formId
        )
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 3: Campaign body structure preserves article data in Keila format
// Feature: keila-newsletter-integration, Property 3: Campaign body structure preserves article data
// **Validates: Requirements 3.3, 3.4**
// ---------------------------------------------------------------------------

describe('Property 3: Campaign body structure preserves article data in Keila format', () => {
  let savedEnv
  beforeEach(() => { savedEnv = { ...process.env } })
  afterEach(() => { process.env = savedEnv })

  test('campaign body has correct structure with article title and excerpt', () => {
    const titleArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0)
    const excerptArb = fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0)
    const senderIdArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0)

    fc.assert(
      fc.asyncProperty(titleArb, excerptArb, senderIdArb, async (title, excerpt, senderId) => {
        process.env.NEWSLETTER_ACTION_URL = 'http://localhost:4000'
        process.env.NEWSLETTER_API_TOKEN = 'test-token'
        process.env.NEWSLETTER_KEILA_SENDER_ID = senderId
        lastRequestData = null

        const article = { title, excerpt, slug: 'test-slug' }
        const plainText = `${title}\n\n${excerpt}\n\nRead more: http://example.com/news/test-slug/`
        await createKeilaCampaign(article, plainText)

        const parsed = JSON.parse(lastRequestData)
        return (
          parsed.data !== undefined &&
          parsed.data.subject === title &&
          typeof parsed.data.text_body === 'string' &&
          parsed.data.text_body.includes(excerpt) &&
          parsed.data.settings !== undefined &&
          parsed.data.settings.type === 'markdown' &&
          parsed.data.sender_id === senderId
        )
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 4: Missing campaign env vars produce descriptive error
// Feature: keila-newsletter-integration, Property 4: Missing campaign env vars → descriptive error
// **Validates: Requirements 3.5**
// ---------------------------------------------------------------------------

describe('Property 4: Missing campaign env vars produce descriptive error', () => {
  const CAMPAIGN_VARS = ['NEWSLETTER_ACTION_URL', 'NEWSLETTER_API_TOKEN', 'NEWSLETTER_KEILA_SENDER_ID']

  let savedEnv
  beforeEach(() => { savedEnv = { ...process.env } })
  afterEach(() => { process.env = savedEnv })

  test('missing campaign vars produce error naming every missing variable', () => {
    const subsetArb = fc.subarray(CAMPAIGN_VARS, { minLength: 0, maxLength: CAMPAIGN_VARS.length - 1 })
    const valueArb = fc.string({ minLength: 1, maxLength: 50 })

    fc.assert(
      fc.asyncProperty(subsetArb, valueArb, async (presentVars, value) => {
        for (const v of CAMPAIGN_VARS) { delete process.env[v] }
        for (const v of presentVars) { process.env[v] = value }

        const missingVars = CAMPAIGN_VARS.filter(v => !presentVars.includes(v))
        const article = { title: 'Test', excerpt: 'Test excerpt', slug: 'test' }

        try {
          await createKeilaCampaign(article, 'plain text')
          return false
        } catch (err) {
          return missingVars.every(v => err.message.includes(v))
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 5: Bearer token produces correct Authorization header
// Feature: keila-newsletter-integration, Property 5: Bearer token → correct Authorization header
// **Validates: Requirements 4.2**
// ---------------------------------------------------------------------------

describe('Property 5: Bearer token produces correct Authorization header', () => {
  test('non-empty bearer token sets Authorization header to "Bearer " + token', () => {
    const tokenArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0)

    fc.assert(
      fc.asyncProperty(tokenArb, async (token) => {
        lastRequestOpts = null
        await postRequest('http://localhost:4000/api/test', '{}', 'json', null, null, token)

        return (
          lastRequestOpts !== null &&
          lastRequestOpts.headers !== undefined &&
          lastRequestOpts.headers.Authorization === 'Bearer ' + token
        )
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 6: Bearer token takes precedence over basic auth
// Feature: keila-newsletter-integration, Property 6: Bearer precedence over basic auth
// **Validates: Requirements 4.3**
// ---------------------------------------------------------------------------

describe('Property 6: Bearer token takes precedence over basic auth', () => {
  test('when both bearer token and basic auth are provided, Bearer is used', () => {
    const tokenArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0)
    const usernameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)
    const passwordArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)

    fc.assert(
      fc.asyncProperty(tokenArb, usernameArb, passwordArb, async (token, username, password) => {
        lastRequestOpts = null
        await postRequest('http://localhost:4000/api/test', '{}', 'json', username, password, token)

        return (
          lastRequestOpts !== null &&
          lastRequestOpts.headers !== undefined &&
          lastRequestOpts.headers.Authorization === 'Bearer ' + token &&
          !lastRequestOpts.headers.Authorization.startsWith('Basic ')
        )
      }),
      { numRuns: 100 }
    )
  })
})
