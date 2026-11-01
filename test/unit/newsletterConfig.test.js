'use strict'

const os = require('os')
const path = require('path')
const { applyConfigToEnv } = require('../../src/configLoader')
const { createCampaignDrafts } = require('../../src/newsletterCampaign')

const KEYS = ['SITE_URL', 'SITE_NAME', 'NEWSLETTER_PROVIDER', 'NEWSLETTER_ACTION_URL', 'NEWSLETTER_LIST_ID',
  'NEWSLETTER_KEILA_FORM_ID', 'NEWSLETTER_DOUBLE_OPTIN', 'NEWSLETTER_AUTO_CAMPAIGN', 'NEWSLETTER_FROM_NAME',
  'NEWSLETTER_FROM_EMAIL', 'NEWSLETTER_REPLY_TO', 'NEWSLETTER_BRAND_ID']
let saved

beforeEach(() => {
  saved = {}
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('applyConfigToEnv', () => {
  test('copies site and newsletter settings from config.json', () => {
    applyConfigToEnv({
      site: { name: 'Aenaos', url: 'https://example.com/' },
      newsletter: { provider: 'keila', actionUrl: 'https://keila.example.com', formId: 'nfrm_1', autoCampaign: false }
    })
    expect(process.env.SITE_NAME).toBe('Aenaos')
    expect(process.env.SITE_URL).toBe('https://example.com/')
    expect(process.env.NEWSLETTER_PROVIDER).toBe('keila')
    expect(process.env.NEWSLETTER_KEILA_FORM_ID).toBe('nfrm_1')
    expect(process.env.NEWSLETTER_AUTO_CAMPAIGN).toBe('false')
  })

  test('existing env vars win', () => {
    process.env.NEWSLETTER_PROVIDER = 'sendy'
    applyConfigToEnv({ newsletter: { provider: 'keila' } })
    expect(process.env.NEWSLETTER_PROVIDER).toBe('sendy')
  })

  test('null config is a no-op', () => {
    applyConfigToEnv(null)
    expect(process.env.SITE_NAME).toBeUndefined()
  })
})

describe('createCampaignDrafts', () => {
  const tmp = path.join(os.tmpdir(), 'lsg-newsletter-test')

  test('auto mode skips when autoCampaign is off', async () => {
    process.env.NEWSLETTER_PROVIDER = 'unknown-provider'
    expect(await createCampaignDrafts([{ slug: 'a', title: 'A' }], tmp)).toBe(0)
  })

  test('manual mode warns and returns 0 without a provider', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await createCampaignDrafts([{ slug: 'a', title: 'A' }], tmp, { manual: true })).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
