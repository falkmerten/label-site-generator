'use strict'

const fc = require('fast-check')
const fs = require('fs/promises')
const path = require('path')
const os = require('os')

const {
  parseCsvFile,
  splitName,
  normalizeStatus,
  isValidEmail,
  logSummary
} = require('../../src/subscriberImport')

// ── Temp file helpers ────────────────────────────────────────────────────────
// Use a unique counter + random suffix per file to avoid collisions across
// parallel test suites sharing the same OS temp directory.
let tmpDir
let tmpCounter = 0

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subimport-prop-'))
})

afterAll(async () => {
  // Best-effort cleanup; ignore errors on Windows where handles may linger
  try { await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
})

async function writeTmpCsv (content) {
  const filePath = path.join(tmpDir, `p${process.pid}-${++tmpCounter}.csv`)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

// Suppress console output during tests
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  console.log.mockRestore()
  console.warn.mockRestore()
  console.error.mockRestore()
})

// ── Helper: randomize casing of a string ─────────────────────────────────────
function randomizeCasing (str, bools) {
  return str
    .split('')
    .map((ch, i) => (bools[i % bools.length] ? ch.toUpperCase() : ch.toLowerCase()))
    .join('')
}

// ---------------------------------------------------------------------------
// Property 6.1: CSV header matching is case-insensitive
// **Validates: Requirements 2.1**
// ---------------------------------------------------------------------------

describe('Property 6.1: CSV header matching is case-insensitive', () => {
  test('random casing variants of headers produce identical parse results', async () => {
    const casingArb = fc.array(fc.boolean(), { minLength: 20, maxLength: 20 })
    const emailLocalArb = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/)
    const domainArb = fc.stringMatching(/^[a-z]{1,6}\.[a-z]{2,4}$/)
    const nameArb = fc.stringMatching(/^[A-Za-z]{1,10}( [A-Za-z]{1,10})?$/)
    const statusArb = fc.constantFrom('active', 'unsubscribed', 'bounced', '')

    await fc.assert(
      fc.asyncProperty(
        casingArb, emailLocalArb, domainArb, nameArb, statusArb,
        async (bools, local, domain, name, status) => {
          const email = `${local}@${domain}`

          // Baseline: lowercase headers
          const baselineCsv = `email,name,status\n${email},${name},${status}\n`
          const baselineFile = await writeTmpCsv(baselineCsv)
          const baselineRecords = await parseCsvFile(baselineFile)

          // Variant: randomized casing headers
          const casedEmail = randomizeCasing('email', bools)
          const casedName = randomizeCasing('name', bools.slice(5))
          const casedStatus = randomizeCasing('status', bools.slice(10))
          const casedCsv = `${casedEmail},${casedName},${casedStatus}\n${email},${name},${status}\n`
          const casedFile = await writeTmpCsv(casedCsv)
          const casedRecords = await parseCsvFile(casedFile)

          expect(casedRecords).toHaveLength(baselineRecords.length)
          if (baselineRecords.length > 0 && casedRecords.length > 0) {
            expect(casedRecords[0].email).toBe(baselineRecords[0].email)
            expect(casedRecords[0].name).toBe(baselineRecords[0].name)
            expect(casedRecords[0].status).toBe(baselineRecords[0].status)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  test('email alias headers with random casing still parse correctly', async () => {
    const casingArb = fc.array(fc.boolean(), { minLength: 30, maxLength: 30 })
    const aliasArb = fc.constantFrom('email', 'e-mail', 'email address', 'subscriber_email')
    const emailLocalArb = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/)
    const domainArb = fc.stringMatching(/^[a-z]{1,6}\.[a-z]{2,4}$/)

    await fc.assert(
      fc.asyncProperty(
        casingArb, aliasArb, emailLocalArb, domainArb,
        async (bools, alias, local, domain) => {
          const email = `${local}@${domain}`
          const casedAlias = randomizeCasing(alias, bools)
          const csv = `${casedAlias}\n${email}\n`
          const file = await writeTmpCsv(csv)
          const records = await parseCsvFile(file)

          expect(records).toHaveLength(1)
          expect(records[0].email).toBe(email)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 6.2: Name splitting preserves all parts
// **Validates: Requirements 5.3**
// ---------------------------------------------------------------------------

describe('Property 6.2: Name splitting preserves all parts', () => {
  test('(first_name + " " + last_name).trim() === name.trim() for any non-empty name', () => {
    const wordArb = fc.stringMatching(/^[A-Za-z\u00C0-\u024F]{1,15}$/)
    const nameArb = fc.array(wordArb, { minLength: 1, maxLength: 5 })
      .map(words => words.join(' '))

    fc.assert(
      fc.property(nameArb, (name) => {
        const { first_name, last_name } = splitName(name)
        const reconstructed = (first_name + ' ' + last_name).trim()
        expect(reconstructed).toBe(name.trim())
      }),
      { numRuns: 100 }
    )
  })

  test('names with extra whitespace are normalized correctly', () => {
    const wordArb = fc.stringMatching(/^[A-Za-z]{1,10}$/)
    const spacesArb = fc.stringMatching(/^ {1,5}$/)
    const nameArb = fc.tuple(
      spacesArb, wordArb, spacesArb, wordArb, spacesArb
    ).map(([s1, w1, s2, w2, s3]) => s1 + w1 + s2 + w2 + s3)

    fc.assert(
      fc.property(nameArb, (name) => {
        const { first_name, last_name } = splitName(name)
        const reconstructed = (first_name + ' ' + last_name).trim()
        const normalized = name.trim().split(/\s+/).join(' ')
        expect(reconstructed).toBe(normalized)
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 6.3: Status mapping normalizes to canonical forms and --active-only filters correctly
// **Validates: Requirements 2.8, 2.9**
// ---------------------------------------------------------------------------

describe('Property 6.3: Status mapping normalizes to canonical forms', () => {
  const KNOWN_ACTIVE = ['subscribed', 'active', 'enabled', '']
  const KNOWN_UNSUBSCRIBED = ['unsubscribed']
  const KNOWN_BOUNCED = ['bounced', 'blocklisted', 'unreachable']
  const ALL_KNOWN = [...KNOWN_ACTIVE, ...KNOWN_UNSUBSCRIBED, ...KNOWN_BOUNCED]
  const CANONICAL = ['active', 'unsubscribed', 'bounced']

  test('all known status values normalize to one of three canonical forms', () => {
    const statusArb = fc.constantFrom(...ALL_KNOWN)

    fc.assert(
      fc.property(statusArb, (status) => {
        const normalized = normalizeStatus(status)
        expect(CANONICAL).toContain(normalized)
      }),
      { numRuns: 100 }
    )
  })

  test('active statuses map to "active"', () => {
    const statusArb = fc.constantFrom(...KNOWN_ACTIVE)

    fc.assert(
      fc.property(statusArb, (status) => {
        expect(normalizeStatus(status)).toBe('active')
      }),
      { numRuns: 100 }
    )
  })

  test('unsubscribed statuses map to "unsubscribed"', () => {
    const statusArb = fc.constantFrom(...KNOWN_UNSUBSCRIBED)

    fc.assert(
      fc.property(statusArb, (status) => {
        expect(normalizeStatus(status)).toBe('unsubscribed')
      }),
      { numRuns: 100 }
    )
  })

  test('bounced statuses map to "bounced"', () => {
    const statusArb = fc.constantFrom(...KNOWN_BOUNCED)

    fc.assert(
      fc.property(statusArb, (status) => {
        expect(normalizeStatus(status)).toBe('bounced')
      }),
      { numRuns: 100 }
    )
  })

  test('--active-only filtering: parsed CSV with activeOnly keeps only active records', async () => {
    const statusArb = fc.constantFrom(...ALL_KNOWN)
    const emailLocalArb = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/)
    const domainArb = fc.constantFrom('test.com', 'example.org', 'mail.net')
    const recordsArb = fc.array(
      fc.tuple(emailLocalArb, domainArb, statusArb),
      { minLength: 1, maxLength: 10 }
    )

    await fc.assert(
      fc.asyncProperty(recordsArb, async (tuples) => {
        // Deduplicate emails
        const seen = new Set()
        const uniqueTuples = tuples.filter(([local, domain]) => {
          const email = `${local}@${domain}`
          if (seen.has(email)) return false
          seen.add(email)
          return true
        })
        if (uniqueTuples.length === 0) return

        const rows = uniqueTuples.map(([local, domain, status]) =>
          `${local}@${domain},Name,${status}`
        ).join('\n')
        const csv = `email,name,status\n${rows}\n`
        const file = await writeTmpCsv(csv)

        const allRecords = await parseCsvFile(file)
        // Simulate --active-only filtering (as done in importSubscribers)
        const activeOnly = allRecords.filter(r => r.status === 'active')

        for (const r of activeOnly) {
          expect(r.status).toBe('active')
        }

        const expectedActive = uniqueTuples.filter(([, , s]) =>
          normalizeStatus(s) === 'active'
        ).length
        expect(activeOnly.length).toBe(expectedActive)
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 6.4: Email validation accepts valid patterns and rejects invalid ones
// **Validates: Requirements 2.6**
// ---------------------------------------------------------------------------

describe('Property 6.4: Email validation', () => {
  test('accepts strings matching local@domain.tld pattern', () => {
    const localArb = fc.stringMatching(/^[a-zA-Z0-9._%+-]{1,20}$/)
      .filter(s => s.length > 0 && !/\s/.test(s))
    const domainArb = fc.stringMatching(/^[a-zA-Z0-9-]{1,10}$/)
      .filter(s => s.length > 0)
    const tldArb = fc.stringMatching(/^[a-zA-Z]{2,6}$/)

    fc.assert(
      fc.property(localArb, domainArb, tldArb, (local, domain, tld) => {
        const email = `${local}@${domain}.${tld}`
        expect(isValidEmail(email)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  test('rejects strings without @', () => {
    const noAtArb = fc.stringMatching(/^[a-zA-Z0-9._%+-]{1,30}$/)
      .filter(s => !s.includes('@'))

    fc.assert(
      fc.property(noAtArb, (str) => {
        expect(isValidEmail(str)).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  test('rejects strings without a dot in the domain part', () => {
    const localArb = fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/)
    const domainNoDotArb = fc.stringMatching(/^[a-zA-Z0-9]{1,15}$/)
      .filter(s => !s.includes('.'))

    fc.assert(
      fc.property(localArb, domainNoDotArb, (local, domain) => {
        const email = `${local}@${domain}`
        expect(isValidEmail(email)).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  test('rejects empty strings', () => {
    expect(isValidEmail('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Property 6.5: Import result counts sum to total processed
// **Validates: Requirements 6.2**
// ---------------------------------------------------------------------------

describe('Property 6.5: Import result counts sum to total processed', () => {
  test('sum of imported + alreadyExists + skipped + failed equals total', () => {
    const resultArb = fc.constantFrom('imported', 'already_exists', 'skipped', 'failed')
    const resultsArb = fc.array(
      fc.record({
        email: fc.stringMatching(/^[a-z]{1,5}@test\.com$/),
        result: resultArb,
        reason: fc.constant(undefined)
      }),
      { minLength: 0, maxLength: 50 }
    )

    fc.assert(
      fc.property(resultsArb, (results) => {
        const summary = logSummary(results)
        expect(summary.imported + summary.alreadyExists + summary.skipped + summary.failed)
          .toBe(summary.total)
        expect(summary.total).toBe(results.length)
      }),
      { numRuns: 100 }
    )
  })

  test('empty results produce all-zero summary', () => {
    const summary = logSummary([])
    expect(summary.total).toBe(0)
    expect(summary.imported).toBe(0)
    expect(summary.alreadyExists).toBe(0)
    expect(summary.skipped).toBe(0)
    expect(summary.failed).toBe(0)
  })
})
