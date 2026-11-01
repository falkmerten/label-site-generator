'use strict'

// Mock markdown.js to avoid ESM dependency chain (isomorphic-dompurify/jsdom)
jest.mock('../../src/markdown', () => ({ renderMarkdown: (md) => md }))

const fs = require('fs')
const path = require('path')
const nunjucks = require('nunjucks')
const { resolveNewsletter } = require('../../src/renderer')

const SECRET = 'sendy-admin-key-SECRET123'
const KEYS = ['NEWSLETTER_PROVIDER', 'NEWSLETTER_ACTION_URL', 'NEWSLETTER_LIST_ID', 'NEWSLETTER_API_TOKEN', 'NEWSLETTER_API_KEY', 'NEWSLETTER_DOUBLE_OPTIN']
let saved

beforeEach(() => {
  saved = {}
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.NEWSLETTER_PROVIDER = 'sendy'
  process.env.NEWSLETTER_ACTION_URL = 'https://sendy.example.com'
  process.env.NEWSLETTER_LIST_ID = 'encryptedListId'
  process.env.NEWSLETTER_API_TOKEN = SECRET
  process.env.NEWSLETTER_API_KEY = SECRET
  process.env.NEWSLETTER_DOUBLE_OPTIN = 'true'
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('Sendy admin API key is never exposed', () => {
  test('resolveNewsletter does not return the API key', () => {
    const nl = resolveNewsletter({})
    expect(nl.provider).toBe('sendy')
    expect(JSON.stringify(nl)).not.toContain(SECRET)
  })

  test('signup form HTML contains no api_key, even if a key is passed in', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '../../templates/shared')), { autoescape: true })
    const html = env.render('newsletter-form.njk', {
      newsletter: { ...resolveNewsletter({}), apiKey: SECRET },
      labelEmail: 'info@example.com',
      labelName: 'Test Label'
    })
    expect(html).toContain('encryptedListId')
    expect(html).not.toContain(SECRET)
    expect(html).not.toMatch(/append\('api_key'/)
  })

  test('no template appends api_key', () => {
    const files = ['shared/newsletter-form.njk', 'label/index.njk', 'artist/index.njk']
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '../../templates', f), 'utf8')
      expect(src).not.toMatch(/append\('api_key'/)
      expect(src).not.toContain('newsletter.apiKey')
    }
  })

  test('"already subscribed" gets the same reply as a new signup', () => {
    for (const f of ['shared/newsletter-form.njk', 'label/index.njk']) {
      const src = fs.readFileSync(path.join(__dirname, '../../templates', f), 'utf8')
      expect(src).not.toContain('You are already subscribed')
    }
  })
})
