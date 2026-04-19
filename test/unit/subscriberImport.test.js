'use strict'

const path = require('path')
const fs = require('fs/promises')
const os = require('os')
const http = require('http')
const https = require('https')

const {
  parseCsvFile,
  parseCsvLine,
  discoverCsvFiles,
  splitName,
  sanitizeName,
  properCaseName,
  properCaseWord,
  validateEnvVars,
  normalizeStatus,
  isValidEmail,
  importToSendy,
  importToListmonk,
  importToKeila,
  logSummary
} = require('../../src/subscriberImport')

// ── Mock http/https to prevent real network calls ────────────────────────────
let mockResponseBody = '1'
let mockStatusCode = 200
let lastRequestOpts = null
let lastRequestData = null

function createMockReqRes (cb) {
  const { EventEmitter } = require('events')
  const res = new EventEmitter()
  res.statusCode = mockStatusCode
  process.nextTick(() => {
    cb(res)
    process.nextTick(() => {
      res.emit('data', mockResponseBody)
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

// ── Env helpers ──────────────────────────────────────────────────────────────
let savedEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  lastRequestOpts = null
  lastRequestData = null
  mockResponseBody = '1'
  mockStatusCode = 200
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.env = savedEnv
  console.log.mockRestore()
  console.warn.mockRestore()
  console.error.mockRestore()
})

// ── Temp file helpers ────────────────────────────────────────────────────────
let tmpDir
beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subimport-'))
})
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeTmpCsv (filename, content) {
  const filePath = path.join(tmpDir, filename)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvLine
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvLine', () => {
  test('splits simple comma-separated values', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  test('handles quoted fields', () => {
    expect(parseCsvLine('"Name","Email","Status"')).toEqual(['Name', 'Email', 'Status'])
  })

  test('handles escaped quotes inside quoted fields', () => {
    expect(parseCsvLine('"He said ""hello""",b')).toEqual(['He said "hello"', 'b'])
  })

  test('handles empty fields', () => {
    expect(parseCsvLine('a,,c,')).toEqual(['a', '', 'c', ''])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvFile — standard format
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvFile — standard format', () => {
  test('parses standard email,name,status CSV', async () => {
    const file = await writeTmpCsv('standard.csv',
      'email,name,status\ntest@example.com,John Doe,active\nother@test.org,Jane,unsubscribed\n')
    const records = await parseCsvFile(file)
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({ email: 'test@example.com', name: 'John Doe', status: 'active', autoTag: 'subscriber', _row: 2 })
    expect(records[1]).toEqual({ email: 'other@test.org', name: 'Jane', status: 'unsubscribed', autoTag: 'subscriber', _row: 3 })
  })

  test('trims whitespace from all fields', async () => {
    const file = await writeTmpCsv('whitespace.csv',
      'email , name , status\n  test@example.com , John Doe , active \n')
    const records = await parseCsvFile(file)
    expect(records[0].email).toBe('test@example.com')
    expect(records[0].name).toBe('John Doe')
    expect(records[0].status).toBe('active')
  })

  test('defaults empty status to active', async () => {
    const file = await writeTmpCsv('nostatus.csv',
      'email,name\ntest@example.com,John\n')
    const records = await parseCsvFile(file)
    expect(records[0].status).toBe('active')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvFile — Sendy format (quoted headers)
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvFile — Sendy format', () => {
  test('parses Sendy export with quoted headers', async () => {
    const file = await writeTmpCsv('sendy.csv',
      '"Name","Email","Joined","Last activity","Added via","Opt-in method","IP address","Country","Country code","Signed up from","Status","GDPR"\n' +
      '"Filip","filip@example.com","","2026/04/19","App","","","","","","Active","Yes"\n')
    const records = await parseCsvFile(file)
    expect(records).toHaveLength(1)
    expect(records[0].email).toBe('filip@example.com')
    expect(records[0].name).toBe('Filip')
    expect(records[0].status).toBe('active')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvFile — Bandcamp format (firstname + lastname)
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvFile — Bandcamp format', () => {
  test('joins firstname and lastname into name', async () => {
    const file = await writeTmpCsv('bandcamp.csv',
      'email,fullname,firstname,lastname,date added,country,postal code,num purchases\n' +
      'test@example.com,ulrich hagn,ulrich,hagn,Sep 23 2010,DE,,4\n')
    const records = await parseCsvFile(file)
    expect(records).toHaveLength(1)
    // firstname+lastname preferred over fullname
    expect(records[0].name).toBe('Ulrich Hagn')
  })

  test('handles empty firstname/lastname', async () => {
    const file = await writeTmpCsv('bandcamp-empty.csv',
      'email,fullname,firstname,lastname,date added\n' +
      'test@example.com,,,,Sep 23 2010\n')
    const records = await parseCsvFile(file)
    expect(records[0].name).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvFile — missing email column
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvFile — missing email column', () => {
  test('returns empty array and logs error when no email column', async () => {
    const file = await writeTmpCsv('noemail.csv',
      'name,status\nJohn,active\n')
    const records = await parseCsvFile(file)
    expect(records).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No email column'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvFile — invalid emails
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvFile — invalid emails', () => {
  test('skips rows with invalid emails and logs warning', async () => {
    const file = await writeTmpCsv('invalid.csv',
      'email,name\nvalid@test.com,Good\nbad-email,Bad\n,Empty\n')
    const records = await parseCsvFile(file)
    expect(records).toHaveLength(1)
    expect(records[0].email).toBe('valid@test.com')
    expect(console.warn).toHaveBeenCalledTimes(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// parseCsvFile — case-insensitive headers
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseCsvFile — case-insensitive headers', () => {
  test('matches headers regardless of case', async () => {
    const file = await writeTmpCsv('casing.csv',
      'EMAIL,NAME,STATUS\ntest@example.com,John,Active\n')
    const records = await parseCsvFile(file)
    expect(records).toHaveLength(1)
    expect(records[0].email).toBe('test@example.com')
    expect(records[0].status).toBe('active')
  })

  test('matches Email Address alias', async () => {
    const file = await writeTmpCsv('alias.csv',
      'Email Address,Sender Name\ntest@example.com,John\n')
    const records = await parseCsvFile(file)
    expect(records).toHaveLength(1)
    expect(records[0].email).toBe('test@example.com')
    expect(records[0].name).toBe('John')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// normalizeStatus
// ═══════════════════════════════════════════════════════════════════════════════
describe('normalizeStatus', () => {
  test.each([
    ['subscribed', 'active'],
    ['active', 'active'],
    ['enabled', 'active'],
    ['Active', 'active'],
    ['', 'active'],
    ['unsubscribed', 'unsubscribed'],
    ['Unsubscribed', 'unsubscribed'],
    ['bounced', 'bounced'],
    ['blocklisted', 'bounced'],
    ['unreachable', 'bounced']
  ])('normalizeStatus(%s) → %s', (input, expected) => {
    expect(normalizeStatus(input)).toBe(expected)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// isValidEmail
// ═══════════════════════════════════════════════════════════════════════════════
describe('isValidEmail', () => {
  test.each([
    ['test@example.com', true],
    ['user@sub.domain.org', true],
    ['a@b.c', true],
    ['bad-email', false],
    ['@missing.com', false],
    ['no-domain@', false],
    ['no@dot', false],
    ['', false]
  ])('isValidEmail(%s) → %s', (input, expected) => {
    expect(isValidEmail(input)).toBe(expected)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// splitName
// ═══════════════════════════════════════════════════════════════════════════════
describe('splitName', () => {
  test('splits two-word name', () => {
    expect(splitName('John Doe')).toEqual({ first_name: 'John', last_name: 'Doe' })
  })

  test('single word → first_name only', () => {
    expect(splitName('Madonna')).toEqual({ first_name: 'Madonna', last_name: '' })
  })

  test('three words → first + rest', () => {
    expect(splitName('Jean Claude Van')).toEqual({ first_name: 'Jean', last_name: 'Claude Van' })
  })

  test('empty string → both empty', () => {
    expect(splitName('')).toEqual({ first_name: '', last_name: '' })
  })

  test('null → both empty', () => {
    expect(splitName(null)).toEqual({ first_name: '', last_name: '' })
  })

  test('whitespace only → both empty', () => {
    expect(splitName('   ')).toEqual({ first_name: '', last_name: '' })
  })

  test('trims leading/trailing whitespace', () => {
    expect(splitName('  John  Doe  ')).toEqual({ first_name: 'John', last_name: 'Doe' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// properCaseName / properCaseWord
// ═══════════════════════════════════════════════════════════════════════════════
describe('properCaseName', () => {
  test('lowercases all-caps name', () => {
    expect(properCaseName('JOHN DOE')).toBe('John Doe')
  })

  test('capitalizes all-lowercase name', () => {
    expect(properCaseName('john doe')).toBe('John Doe')
  })

  test('preserves already proper-cased name', () => {
    expect(properCaseName('John Doe')).toBe('John Doe')
  })

  test('handles single word', () => {
    expect(properCaseName('madonna')).toBe('Madonna')
  })

  test('handles hyphenated names', () => {
    expect(properCaseName('jean-pierre')).toBe('Jean-Pierre')
    expect(properCaseName('JEAN-PIERRE')).toBe('Jean-Pierre')
  })

  test('handles apostrophe names', () => {
    expect(properCaseName("o'brien")).toBe("O'Brien")
  })

  test('empty/null returns empty', () => {
    expect(properCaseName('')).toBe('')
    expect(properCaseName(null)).toBe('')
  })

  test('trims whitespace', () => {
    expect(properCaseName('  john  doe  ')).toBe('John Doe')
  })
})

describe('sanitizeName', () => {
  test('proper-cases a valid name', () => {
    expect(sanitizeName('john doe')).toBe('John Doe')
    expect(sanitizeName('JOHN DOE')).toBe('John Doe')
  })

  test('rejects garbage/spam names', () => {
    expect(sanitizeName('tPFZsERqhnXOaWDLYDuizqu')).toBe('')
  })

  test('rejects too-short names', () => {
    expect(sanitizeName('X')).toBe('')
  })

  test('returns empty for empty input', () => {
    expect(sanitizeName('')).toBe('')
    expect(sanitizeName(null)).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// validateEnvVars
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateEnvVars', () => {
  test('returns missing vars for sendy', () => {
    delete process.env.NEWSLETTER_PROVIDER
    delete process.env.NEWSLETTER_ACTION_URL
    delete process.env.NEWSLETTER_API_KEY
    const missing = validateEnvVars('sendy')
    expect(missing).toContain('NEWSLETTER_PROVIDER')
    expect(missing).toContain('NEWSLETTER_ACTION_URL')
    expect(missing).toContain('NEWSLETTER_API_KEY')
  })

  test('returns empty when all sendy vars set', () => {
    process.env.NEWSLETTER_PROVIDER = 'sendy'
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost'
    process.env.NEWSLETTER_API_KEY = 'key123'
    expect(validateEnvVars('sendy')).toEqual([])
  })

  test('returns missing vars for listmonk', () => {
    delete process.env.NEWSLETTER_PROVIDER
    delete process.env.NEWSLETTER_ACTION_URL
    delete process.env.NEWSLETTER_API_USER
    delete process.env.NEWSLETTER_API_TOKEN
    const missing = validateEnvVars('listmonk')
    expect(missing).toContain('NEWSLETTER_API_USER')
    expect(missing).toContain('NEWSLETTER_API_TOKEN')
  })

  test('returns missing vars for keila', () => {
    delete process.env.NEWSLETTER_PROVIDER
    delete process.env.NEWSLETTER_ACTION_URL
    delete process.env.NEWSLETTER_API_TOKEN
    const missing = validateEnvVars('keila')
    expect(missing).toContain('NEWSLETTER_API_TOKEN')
  })

  test('returns empty when all keila vars set', () => {
    process.env.NEWSLETTER_PROVIDER = 'keila'
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost'
    process.env.NEWSLETTER_API_TOKEN = 'token123'
    expect(validateEnvVars('keila')).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// discoverCsvFiles
// ═══════════════════════════════════════════════════════════════════════════════
describe('discoverCsvFiles', () => {
  test('returns CSV files from a directory', async () => {
    const dir = path.join(tmpDir, 'discover-dir')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'a.csv'), 'email\n', 'utf8')
    await fs.writeFile(path.join(dir, 'b.csv'), 'email\n', 'utf8')
    await fs.writeFile(path.join(dir, 'readme.txt'), 'not csv', 'utf8')

    const files = await discoverCsvFiles(dir)
    expect(files).toHaveLength(2)
    expect(files.every(f => f.endsWith('.csv'))).toBe(true)
  })

  test('returns single CSV file', async () => {
    const file = path.join(tmpDir, 'single.csv')
    await fs.writeFile(file, 'email\n', 'utf8')
    const files = await discoverCsvFiles(file)
    expect(files).toEqual([file])
  })

  test('returns empty for non-existent path', async () => {
    const files = await discoverCsvFiles(path.join(tmpDir, 'nope'))
    expect(files).toEqual([])
  })

  test('returns empty for empty directory', async () => {
    const dir = path.join(tmpDir, 'empty-dir')
    await fs.mkdir(dir, { recursive: true })
    const files = await discoverCsvFiles(dir)
    expect(files).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// importToSendy
// ═══════════════════════════════════════════════════════════════════════════════
describe('importToSendy', () => {
  beforeEach(() => {
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost:3000'
    process.env.NEWSLETTER_API_KEY = 'test-key'
  })

  test('records imported on response "1"', async () => {
    mockResponseBody = '1'
    mockStatusCode = 200
    const results = await importToSendy(
      [{ email: 'test@example.com', name: 'Test', status: 'active', _row: 2 }],
      'list123', false
    )
    expect(results).toHaveLength(1)
    expect(results[0].result).toBe('imported')
  })

  test('records already_exists on "Already subscribed."', async () => {
    mockResponseBody = 'Already subscribed.'
    mockStatusCode = 200
    const results = await importToSendy(
      [{ email: 'test@example.com', name: 'Test', status: 'active', _row: 2 }],
      'list123', false
    )
    expect(results[0].result).toBe('already_exists')
  })

  test('skips bounced subscribers', async () => {
    const results = await importToSendy(
      [{ email: 'bounce@example.com', name: '', status: 'bounced', _row: 2 }],
      'list123', false
    )
    expect(results[0].result).toBe('skipped')
  })

  test('dry run does not make API calls', async () => {
    const results = await importToSendy(
      [{ email: 'test@example.com', name: 'Test', status: 'active', _row: 2 }],
      'list123', true
    )
    expect(results[0].result).toBe('imported')
    expect(lastRequestOpts).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// importToListmonk
// ═══════════════════════════════════════════════════════════════════════════════
describe('importToListmonk', () => {
  beforeEach(() => {
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost:9000'
    process.env.NEWSLETTER_API_USER = 'admin'
    process.env.NEWSLETTER_API_TOKEN = 'token'
  })

  test('records imported on HTTP 200', async () => {
    mockResponseBody = '{}'
    mockStatusCode = 200
    const results = await importToListmonk(
      [{ email: 'test@example.com', name: 'Test', status: 'active', _row: 2 }],
      '1', false
    )
    expect(results[0].result).toBe('imported')
    const body = JSON.parse(lastRequestData)
    expect(body.email).toBe('test@example.com')
    expect(body.lists).toEqual([1])
    expect(body.status).toBe('enabled')
    expect(body.preconfirm_subscriptions).toBe(true)
  })

  test('maps unsubscribed status correctly', async () => {
    mockResponseBody = '{}'
    mockStatusCode = 200
    await importToListmonk(
      [{ email: 'test@example.com', name: '', status: 'unsubscribed', _row: 2 }],
      '1', false
    )
    const body = JSON.parse(lastRequestData)
    expect(body.status).toBe('enabled')
    // Always preconfirm to prevent confirmation emails during import
    expect(body.preconfirm_subscriptions).toBe(true)
  })

  test('maps bounced status to blocklisted', async () => {
    mockResponseBody = '{}'
    mockStatusCode = 200
    await importToListmonk(
      [{ email: 'test@example.com', name: '', status: 'bounced', _row: 2 }],
      '1', false
    )
    const body = JSON.parse(lastRequestData)
    expect(body.status).toBe('blocklisted')
  })

  test('dry run does not make API calls', async () => {
    const results = await importToListmonk(
      [{ email: 'test@example.com', name: 'Test', status: 'active', _row: 2 }],
      '1', true
    )
    expect(results[0].result).toBe('imported')
    expect(lastRequestOpts).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// importToKeila
// ═══════════════════════════════════════════════════════════════════════════════
describe('importToKeila', () => {
  beforeEach(() => {
    process.env.NEWSLETTER_ACTION_URL = 'http://localhost:4000'
    process.env.NEWSLETTER_API_TOKEN = 'keila-token'
  })

  test('records imported on HTTP 200 with split name', async () => {
    mockResponseBody = '{}'
    mockStatusCode = 200
    const results = await importToKeila(
      [{ email: 'test@example.com', name: 'John Doe', status: 'active', _row: 2 }],
      false
    )
    expect(results[0].result).toBe('imported')
    const body = JSON.parse(lastRequestData)
    expect(body.data.email).toBe('test@example.com')
    expect(body.data.first_name).toBe('John')
    expect(body.data.last_name).toBe('Doe')
  })

  test('sends empty name fields when no name', async () => {
    mockResponseBody = '{}'
    mockStatusCode = 200
    await importToKeila(
      [{ email: 'test@example.com', name: '', status: 'active', _row: 2 }],
      false
    )
    const body = JSON.parse(lastRequestData)
    expect(body.data.first_name).toBe('')
    expect(body.data.last_name).toBe('')
  })

  test('uses Bearer auth', async () => {
    mockResponseBody = '{}'
    mockStatusCode = 200
    await importToKeila(
      [{ email: 'test@example.com', name: '', status: 'active', _row: 2 }],
      false
    )
    expect(lastRequestOpts.headers.Authorization).toBe('Bearer keila-token')
  })

  test('dry run does not make API calls', async () => {
    const results = await importToKeila(
      [{ email: 'test@example.com', name: 'Test', status: 'active', _row: 2 }],
      true
    )
    expect(results[0].result).toBe('imported')
    expect(lastRequestOpts).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// logSummary
// ═══════════════════════════════════════════════════════════════════════════════
describe('logSummary', () => {
  test('counts all result categories correctly', () => {
    const results = [
      { email: 'a@test.com', result: 'imported' },
      { email: 'b@test.com', result: 'imported' },
      { email: 'c@test.com', result: 'already_exists' },
      { email: 'd@test.com', result: 'skipped' },
      { email: 'e@test.com', result: 'failed', reason: 'error' }
    ]
    const summary = logSummary(results)
    expect(summary.total).toBe(5)
    expect(summary.imported).toBe(2)
    expect(summary.alreadyExists).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.failed).toBe(1)
  })

  test('sum of categories equals total', () => {
    const results = [
      { email: 'a@test.com', result: 'imported' },
      { email: 'b@test.com', result: 'failed', reason: 'err' }
    ]
    const summary = logSummary(results)
    expect(summary.imported + summary.alreadyExists + summary.skipped + summary.failed).toBe(summary.total)
  })
})
