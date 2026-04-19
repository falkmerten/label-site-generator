'use strict'

const fs = require('fs/promises')
const path = require('path')
const { postRequest } = require('./newsletterCampaign')

// ── Header alias map ─────────────────────────────────────────────────────────
const EMAIL_ALIASES = ['email', 'e-mail', 'email address', 'from email address', 'absender e-mail-adresse', 'empfänger e-mail-adresse', 'subscriber_email']
const NAME_ALIASES = ['name', 'fullname', 'subscriber name', 'sender name']
const FIRST_NAME_ALIASES = ['first_name', 'first name', 'firstname', 'vorname']
const LAST_NAME_ALIASES = ['last_name', 'last name', 'lastname', 'nachname']
const STATUS_ALIASES = ['status', 'subscriber_status']
const PURCHASES_ALIASES = ['num purchases', 'num_purchases', 'purchases']
const CUSTOMER_ID_ALIASES = ['kundennummer', 'customer_id', 'customer id', 'customer number']

// ── Status mapping ───────────────────────────────────────────────────────────
const ACTIVE_STATUSES = ['subscribed', 'active', 'enabled', '']
const UNSUBSCRIBED_STATUSES = ['unsubscribed']
const BOUNCED_STATUSES = ['bounced', 'blocklisted', 'unreachable', 'marked as spam']
const UNCONFIRMED_STATUSES = ['unconfirmed']

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── CSV parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a single CSV line, handling quoted fields.
 * Handles fields wrapped in double quotes (e.g. Sendy exports).
 */
function parseCsvLine (line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

/**
 * Find the index of a header matching one of the given aliases (case-insensitive).
 */
function findHeaderIndex (headers, aliases) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase()
    if (aliases.includes(h)) return i
  }
  return -1
}

/**
 * Normalize a status string to one of: 'active', 'unsubscribed', 'bounced'.
 */
function normalizeStatus (raw) {
  const s = (raw || '').trim().toLowerCase()
  if (UNSUBSCRIBED_STATUSES.includes(s)) return 'unsubscribed'
  if (BOUNCED_STATUSES.includes(s)) return 'bounced'
  if (UNCONFIRMED_STATUSES.includes(s)) return 'unconfirmed'
  // Default: active (includes 'subscribed', 'active', 'enabled', empty)
  return 'active'
}

/**
 * Validate an email address using a basic format check.
 */
function isValidEmail (email) {
  return EMAIL_REGEX.test(email)
}

/**
 * Split a full name into first_name and last_name.
 * Single word → first_name only, last_name is empty.
 * Empty/whitespace → both empty.
 */
function splitName (name) {
  if (!name || !name.trim()) return { first_name: '', last_name: '' }
  const parts = name.trim().split(/\s+/)
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' ')
  }
}

/**
 * Proper-case a single name word: first letter uppercase, rest lowercase.
 * Handles hyphenated names (Jean-Pierre), apostrophes (O'Brien), and
 * common prefixes (Mc, Mac) that need internal caps.
 */
function properCaseWord (word) {
  if (!word) return ''
  // Already mixed case and looks intentional (e.g. "McDonald") — leave it
  if (/^[A-Z][a-z]/.test(word) && word !== word.toUpperCase() && word !== word.toLowerCase()) return word
  // Handle hyphenated names: Jean-Pierre
  if (word.includes('-')) return word.split('-').map(properCaseWord).join('-')
  // Handle apostrophes: O'Brien
  if (word.includes("'")) {
    const parts = word.split("'")
    return parts.map(properCaseWord).join("'")
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Normalize a name to proper case.
 * "john doe" → "John Doe", "JOHN DOE" → "John Doe"
 * Preserves intentional mixed case like "McDonald".
 */
function properCaseName (name) {
  if (!name || !name.trim()) return ''
  return name.trim().split(/\s+/).map(properCaseWord).join(' ')
}

/**
 * Check if a name looks like a real human name vs spam/garbage.
 * Returns the cleaned, proper-cased name or empty string if garbage.
 */
function sanitizeName (raw) {
  if (!raw || !raw.trim()) return ''
  const name = raw.trim()
  // Too short or too long for a name
  if (name.length < 2 || name.length > 60) return ''
  // Random string detection: no spaces + mostly lowercase + high consonant ratio
  if (!/\s/.test(name) && name.length > 12) {
    const vowels = (name.match(/[aeiouAEIOU]/g) || []).length
    const ratio = vowels / name.length
    if (ratio < 0.2) return '' // too few vowels = random string
  }
  // Looks like a hash/token (mixed case, no spaces, > 8 chars, has digits or all same case)
  if (!/\s/.test(name) && name.length > 8 && /[A-Z]/.test(name) && /[a-z]/.test(name) && !/^[A-Z][a-z]+$/.test(name)) {
    return '' // mixed case single word that isn't a normal capitalized name
  }
  return properCaseName(name)
}

/**
 * Parse a CSV file and return an array of subscriber records.
 * Returns { email, name, status, _row } objects.
 */
async function parseCsvFile (filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) return []

  const headers = parseCsvLine(lines[0])
  const emailIdx = findHeaderIndex(headers, EMAIL_ALIASES)
  if (emailIdx === -1) {
    console.error(`No email column found in ${filePath}`)
    return []
  }

  const nameIdx = findHeaderIndex(headers, NAME_ALIASES)
  const firstNameIdx = findHeaderIndex(headers, FIRST_NAME_ALIASES)
  const lastNameIdx = findHeaderIndex(headers, LAST_NAME_ALIASES)
  const statusIdx = findHeaderIndex(headers, STATUS_ALIASES)
  const purchasesIdx = findHeaderIndex(headers, PURCHASES_ALIASES)
  const customerIdIdx = findHeaderIndex(headers, CUSTOMER_ID_ALIASES)

  const records = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const email = (fields[emailIdx] || '').trim()
    const rowNum = i + 1 // 1-based, header is row 1

    if (!email || !isValidEmail(email)) {
      console.warn(`Row ${rowNum}: skipping invalid email "${email}"`)
      continue
    }

    // Build name: prefer firstname+lastname over fullname
    let name = ''
    if (firstNameIdx !== -1 || lastNameIdx !== -1) {
      const first = sanitizeName((firstNameIdx !== -1 ? (fields[firstNameIdx] || '') : '').trim())
      const last = sanitizeName((lastNameIdx !== -1 ? (fields[lastNameIdx] || '') : '').trim())
      name = [first, last].filter(Boolean).join(' ')
    } else if (nameIdx !== -1) {
      name = sanitizeName((fields[nameIdx] || '').trim())
    }

    const rawStatus = statusIdx !== -1 ? (fields[statusIdx] || '') : ''
    const status = normalizeStatus(rawStatus)

    // Auto-tag based on num_purchases (Bandcamp): > 0 = customer, 0 = subscriber
    // Also detect Kundennummer/customer_id columns (Sendy customer exports)
    // Default: 'subscriber' when no purchase/customer column is present
    let autoTag = 'subscriber'
    if (purchasesIdx !== -1) {
      const purchases = parseInt((fields[purchasesIdx] || '0').trim(), 10)
      autoTag = purchases > 0 ? 'customer' : 'subscriber'
    } else if (customerIdIdx !== -1) {
      // Presence of a customer ID column means this is a customer export
      const custId = (fields[customerIdIdx] || '').trim()
      autoTag = custId ? 'customer' : 'subscriber'
    }

    records.push({ email, name, status, autoTag, _row: rowNum })
  }

  return records
}

// ── File discovery ───────────────────────────────────────────────────────────

/**
 * Check if a CSV file is a Bandcamp export by peeking at its headers.
 * Bandcamp mailing list exports have a "num purchases" column.
 */
async function isBandcampCsv (filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const firstLine = content.split(/\r?\n/)[0] || ''
    const headers = parseCsvLine(firstLine)
    return findHeaderIndex(headers, PURCHASES_ALIASES) !== -1
  } catch {
    return false
  }
}

/**
 * Discover CSV files from a path (file or directory).
 * Returns an array of absolute file paths, sorted with Bandcamp files first.
 * Bandcamp files are detected by the presence of a "num purchases" header.
 */
async function discoverCsvFiles (importPath) {
  let stat
  try {
    stat = await fs.stat(importPath)
  } catch {
    return []
  }

  if (stat.isFile()) {
    if (importPath.toLowerCase().endsWith('.csv')) return [importPath]
    return []
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(importPath)
    const csvPaths = entries
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => path.join(importPath, f))
      .sort()

    // Sort Bandcamp files first (they have "num purchases" header)
    const bandcamp = []
    const other = []
    for (const p of csvPaths) {
      if (await isBandcampCsv(p)) {
        bandcamp.push(p)
      } else {
        other.push(p)
      }
    }
    if (bandcamp.length > 0 && other.length > 0) {
      console.log(`Detected ${bandcamp.length} Bandcamp file(s) — processing first as primary source.`)
    }
    return [...bandcamp, ...other]
  }

  return []
}

// ── Environment validation ───────────────────────────────────────────────────

/**
 * Validate required env vars for a given provider.
 * Returns an array of missing var names (empty = all good).
 */
function validateEnvVars (provider) {
  const missing = []

  if (!process.env.NEWSLETTER_PROVIDER) missing.push('NEWSLETTER_PROVIDER')
  if (!process.env.NEWSLETTER_ACTION_URL) missing.push('NEWSLETTER_ACTION_URL')

  if (provider === 'sendy') {
    if (!process.env.NEWSLETTER_API_KEY) missing.push('NEWSLETTER_API_KEY')
  } else if (provider === 'listmonk') {
    if (!process.env.NEWSLETTER_API_USER) missing.push('NEWSLETTER_API_USER')
    if (!process.env.NEWSLETTER_API_TOKEN) missing.push('NEWSLETTER_API_TOKEN')
  } else if (provider === 'keila') {
    if (!process.env.NEWSLETTER_API_TOKEN) missing.push('NEWSLETTER_API_TOKEN')
  }

  return missing
}

// ── Provider dispatch ────────────────────────────────────────────────────────

/**
 * Import subscribers to Sendy (one POST /subscribe per subscriber).
 */
async function importToSendy (subscribers, listId, dryRun) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiKey = process.env.NEWSLETTER_API_KEY
  const results = []

  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i]
    const label = `[${i + 1}/${subscribers.length}] ${sub.email}`

    if (sub.status === 'bounced') {
      const result = { email: sub.email, result: 'skipped', reason: 'bounced' }
      results.push(result)
      console.log(`${dryRun ? '(dry run) ' : ''}${label} → skipped (bounced)`)
      continue
    }

    if (dryRun) {
      console.log(`(dry run) ${label} → would import`)
      results.push({ email: sub.email, result: 'imported' })
      if (i < subscribers.length - 1) await sleep(0)
      continue
    }

    try {
      const querystring = require('querystring')
      const { first_name } = splitName(sub.name)
      const data = querystring.stringify({
        api_key: apiKey,
        email: sub.email,
        name: first_name || '',
        list: listId,
        boolean: 'true'
      })

      const response = await postRequest(actionUrl + '/subscribe', data, 'form')
      const body = response.trim()

      if (body === '1') {
        results.push({ email: sub.email, result: 'imported' })
        console.log(`${label} → imported`)
      } else if (body === 'Already subscribed.') {
        results.push({ email: sub.email, result: 'already_exists' })
        console.log(`${label} → already exists`)
      } else {
        results.push({ email: sub.email, result: 'failed', reason: body })
        console.log(`${label} → failed: ${body}`)
      }

      // If unsubscribed, subscribe first then unsubscribe
      if (sub.status === 'unsubscribed' && body === '1') {
        const unsubData = querystring.stringify({
          api_key: apiKey,
          email: sub.email,
          list: listId,
          boolean: 'true'
        })
        try {
          await postRequest(actionUrl + '/unsubscribe', unsubData, 'form')
        } catch (err) {
          console.warn(`  Warning: unsubscribe failed for ${sub.email}: ${err.message}`)
        }
      }
    } catch (err) {
      results.push({ email: sub.email, result: 'failed', reason: err.message })
      console.log(`${label} → failed: ${err.message}`)
    }

    if (i < subscribers.length - 1) await sleep(200)
  }

  return results
}

/**
 * Import subscribers to Listmonk (one POST /api/subscribers per subscriber).
 */
async function importToListmonk (subscribers, listId, dryRun) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiUser = process.env.NEWSLETTER_API_USER
  const apiToken = process.env.NEWSLETTER_API_TOKEN
  const results = []

  const parsedListId = parseInt(listId, 10)
  if (!dryRun && (isNaN(parsedListId) || parsedListId <= 0)) {
    console.error(`Invalid Listmonk list ID: "${listId}". Use --list <id> or --create-list <name>.`)
    return results
  }

  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i]
    const label = `[${i + 1}/${subscribers.length}] ${sub.email}`

    if (dryRun) {
      console.log(`(dry run) ${label} → would import`)
      results.push({ email: sub.email, result: 'imported' })
      if (i < subscribers.length - 1) await sleep(0)
      continue
    }

    // Map internal status to Listmonk status
    // Listmonk subscriber status: 'enabled' or 'blocklisted'
    // Subscription status: 'confirmed' or 'unconfirmed' (per-list)
    // CRITICAL: Always preconfirm to prevent confirmation emails during import.
    // For unsubscribed contacts: create as enabled + preconfirmed, then the
    // subscription status is managed separately (Listmonk doesn't have a
    // per-subscriber unsubscribe — it's per-list via the public unsubscribe link).
    let listmonkStatus = 'enabled'
    if (sub.status === 'bounced') {
      listmonkStatus = 'blocklisted'
    }

    try {
      const { first_name } = splitName(sub.name)
      const body = JSON.stringify({
        email: sub.email,
        name: first_name || '',
        lists: [parsedListId],
        status: listmonkStatus,
        preconfirm_subscriptions: true
      })

      await postRequest(actionUrl + '/api/subscribers', body, 'json', apiUser, apiToken)
      results.push({ email: sub.email, result: 'imported' })
      console.log(`${label} → imported`)
    } catch (err) {
      if (err.message && err.message.includes('409')) {
        results.push({ email: sub.email, result: 'already_exists' })
        console.log(`${label} → already exists`)
      } else {
        results.push({ email: sub.email, result: 'failed', reason: err.message })
        console.log(`${label} → failed: ${err.message}`)
      }
    }

    if (i < subscribers.length - 1) await sleep(50)
  }

  return results
}

/**
 * Import subscribers to Keila (one POST /api/v1/contacts per subscriber).
 * When a tag is provided, it's stored in the contact's data.source array.
 * If the contact already exists (409), the tag is appended via PATCH.
 */
async function importToKeila (subscribers, dryRun, tag) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiToken = process.env.NEWSLETTER_API_TOKEN
  const results = []

  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i]
    const label = `[${i + 1}/${subscribers.length}] ${sub.email}`

    // Build tags: combine explicit --tag with autoTag from CSV
    const tags = []
    if (tag) tags.push(tag)
    if (sub.autoTag && !tags.includes(sub.autoTag)) tags.push(sub.autoTag)
    const tagLabel = tags.length > 0 ? ` [tags: ${tags.join(', ')}]` : ''

    if (dryRun) {
      console.log(`(dry run) ${label} → would import${tagLabel}`)
      results.push({ email: sub.email, result: 'imported' })
      if (i < subscribers.length - 1) await sleep(0)
      continue
    }

    const { first_name, last_name } = splitName(sub.name)
    const contactData = tags.length > 0 ? { source: tags } : {}

    try {
      const body = JSON.stringify({
        data: {
          email: sub.email,
          first_name,
          last_name,
          data: contactData
        }
      })

      await postRequest(actionUrl + '/api/v1/contacts', body, 'json', null, null, apiToken)

      // If the contact was created with a non-active status, PATCH it immediately
      // (Keila API always creates contacts as active)
      if (sub.status !== 'active') {
        const keilaStatus = sub.status === 'bounced' ? 'unreachable' : sub.status
        try {
          await new Promise((resolve, reject) => {
            const parsed = new URL(`${actionUrl}/api/v1/contacts/${encodeURIComponent(sub.email)}?id_type=email`)
            const protocol = parsed.protocol === 'https:' ? require('https') : require('http')
            const patchData = JSON.stringify({ data: { status: keilaStatus } })
            const req = protocol.request({
              hostname: parsed.hostname,
              port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(patchData),
                Authorization: 'Bearer ' + apiToken
              }
            }, res => {
              let body = ''
              res.on('data', c => body += c)
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(body)
                else reject(new Error(`PATCH status ${res.statusCode}`))
              })
            })
            req.on('error', reject)
            req.write(patchData)
            req.end()
          })
          console.log(`${label} → imported, status → ${keilaStatus}${tagLabel}`)
        } catch {
          console.log(`${label} → imported${tagLabel} (status update to ${keilaStatus} failed)`)
        }
      } else {
        console.log(`${label} → imported${tagLabel}`)
      }
      results.push({ email: sub.email, result: 'imported' })
    } catch (err) {
      if (err.message && (err.message.includes('409') || err.message.includes('has already been taken'))) {
        // Contact exists — handle tag append and status downgrade
        try {
          // Fetch existing contact
          const getRes = await new Promise((resolve, reject) => {
            const parsed = new URL(`${actionUrl}/api/v1/contacts/${encodeURIComponent(sub.email)}?id_type=email`)
            const protocol = parsed.protocol === 'https:' ? require('https') : require('http')
            const req = protocol.request({
              hostname: parsed.hostname,
              port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: 'GET',
              headers: { Authorization: 'Bearer ' + apiToken, Accept: 'application/json' }
            }, res => {
              let body = ''
              res.on('data', c => body += c)
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  try { resolve(JSON.parse(body)) } catch { resolve(null) }
                } else { resolve(null) }
              })
            })
            req.on('error', () => resolve(null))
            req.end()
          })

          const updates = []

          // Tag append — add all new tags
          if (tags.length > 0 && getRes && getRes.data) {
            const existingSource = (getRes.data.data && Array.isArray(getRes.data.data.source))
              ? getRes.data.data.source
              : []
            const newTags = tags.filter(t => !existingSource.includes(t))
            if (newTags.length > 0) {
              const mergedSource = [...existingSource, ...newTags]
              const patchBody = JSON.stringify({ data: { source: mergedSource } })
              await postRequest(
                `${actionUrl}/api/v1/contacts/${encodeURIComponent(sub.email)}/data?id_type=email`,
                patchBody, 'json', null, null, apiToken
              )
              updates.push(`tags added: ${newTags.join(', ')}`)
            }
          }

          // Name enrichment: fill, improve, or normalize case
          if (getRes && getRes.data) {
            const existingFirst = (getRes.data.first_name || '').trim()
            const existingLast = (getRes.data.last_name || '').trim()
            const existingFull = [existingFirst, existingLast].filter(Boolean).join(' ')

            // Determine best name: from new record or proper-case the existing one
            let targetFirst, targetLast, reason
            if (sub.name) {
              const { first_name: newFirst, last_name: newLast } = splitName(sub.name)
              const newFull = [newFirst, newLast].filter(Boolean).join(' ')
              if (!existingFull) {
                targetFirst = newFirst; targetLast = newLast; reason = 'name filled'
              } else if (newFull.length > existingFull.length) {
                targetFirst = newFirst; targetLast = newLast; reason = 'name improved'
              }
            }
            // If no better name from new record, normalize case of existing name
            if (!targetFirst && existingFull) {
              const normalized = properCaseName(existingFull)
              if (normalized !== existingFull) {
                const parts = splitName(normalized)
                targetFirst = parts.first_name; targetLast = parts.last_name; reason = 'name normalized'
              }
            }

            if (targetFirst) {
              try {
                const patchData = JSON.stringify({ data: { first_name: targetFirst, last_name: targetLast || '' } })
                await new Promise((resolve, reject) => {
                  const parsed = new URL(`${actionUrl}/api/v1/contacts/${encodeURIComponent(sub.email)}?id_type=email`)
                  const protocol = parsed.protocol === 'https:' ? require('https') : require('http')
                  const req = protocol.request({
                    hostname: parsed.hostname,
                    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'Content-Length': Buffer.byteLength(patchData),
                      Authorization: 'Bearer ' + apiToken
                    }
                  }, res => {
                    let body = ''
                    res.on('data', c => body += c)
                    res.on('end', () => {
                      if (res.statusCode >= 200 && res.statusCode < 300) resolve(body)
                      else reject(new Error(`PATCH name ${res.statusCode}`))
                    })
                  })
                  req.on('error', reject)
                  req.write(patchData)
                  req.end()
                })
                updates.push(`${reason} → ${targetFirst}${targetLast ? ' ' + targetLast : ''}`)
              } catch {
                // Name update failed — not critical
              }
            }
          }

          // Status downgrade: most restrictive wins (active < unsubscribed < bounced)
          if (getRes && getRes.data && sub.status !== 'active') {
            const STATUS_RANK = { active: 0, unsubscribed: 1, unreachable: 2 }
            const keilaStatus = sub.status === 'bounced' ? 'unreachable' : sub.status
            const existingStatus = getRes.data.status || 'active'
            const existingRank = STATUS_RANK[existingStatus] || 0
            const newRank = STATUS_RANK[keilaStatus] || 0

            if (newRank > existingRank) {
              // Use PATCH to update contact status
              await new Promise((resolve, reject) => {
                const parsed = new URL(`${actionUrl}/api/v1/contacts/${encodeURIComponent(sub.email)}?id_type=email`)
                const protocol = parsed.protocol === 'https:' ? require('https') : require('http')
                const patchData = JSON.stringify({ data: { status: keilaStatus } })
                const req = protocol.request({
                  hostname: parsed.hostname,
                  port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                  path: parsed.pathname + parsed.search,
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(patchData),
                    Authorization: 'Bearer ' + apiToken
                  }
                }, res => {
                  let body = ''
                  res.on('data', c => body += c)
                  res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve(body)
                    else reject(new Error(`PATCH status ${res.statusCode}: ${body.slice(0, 200)}`))
                  })
                })
                req.on('error', reject)
                req.write(patchData)
                req.end()
              })
              updates.push(`status → ${keilaStatus}`)
            }
          }

          if (updates.length > 0) {
            results.push({ email: sub.email, result: 'already_exists', updated: true })
            console.log(`${label} → already exists, ${updates.join(', ')}`)
          } else {
            results.push({ email: sub.email, result: 'already_exists' })
            console.log(`${label} → already exists`)
          }
        } catch (patchErr) {
          results.push({ email: sub.email, result: 'already_exists' })
          console.log(`${label} → already exists (update failed: ${patchErr.message})`)
        }
      } else {
        results.push({ email: sub.email, result: 'failed', reason: err.message })
        console.log(`${label} → failed: ${err.message}`)
      }
    }

    if (i < subscribers.length - 1) await sleep(50)
  }

  return results
}

// ── Progress logging and summary ─────────────────────────────────────────────

/**
 * Log a summary of import results.
 */
function logSummary (results) {
  const imported = results.filter(r => r.result === 'imported').length
  const alreadyExists = results.filter(r => r.result === 'already_exists').length
  const skipped = results.filter(r => r.result === 'skipped').length
  const failed = results.filter(r => r.result === 'failed').length

  console.log(`\nSummary:`)
  console.log(`  Total processed: ${results.length}`)
  console.log(`  Imported:        ${imported}`)
  console.log(`  Already exists:  ${alreadyExists}`)
  console.log(`  Skipped:         ${skipped}`)
  console.log(`  Failed:          ${failed}`)

  return { total: results.length, imported, alreadyExists, skipped, failed }
}

// ── List/Segment creation ────────────────────────────────────────────────────

/**
 * Create a list in Listmonk via API. Returns the list ID (integer).
 */
async function createListmonkList (name) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiUser = process.env.NEWSLETTER_API_USER
  const apiToken = process.env.NEWSLETTER_API_TOKEN

  const body = JSON.stringify({
    name,
    type: 'public',
    optin: 'double',
    tags: ['import']
  })

  const response = await postRequest(actionUrl + '/api/lists', body, 'json', apiUser, apiToken)
  const data = JSON.parse(response)
  const listId = data.data ? data.data.id : data.id
  console.log(`Created Listmonk list "${name}" (ID: ${listId})`)
  return String(listId)
}

/**
 * Create a segment in Keila via API based on a tag. Returns the segment ID.
 * When tags is an array, creates a filter matching contacts with any of the given tags.
 * When tags is a string, wraps it in an array.
 * When tags is empty/null, creates a segment matching all contacts with any source tag.
 */
async function createKeilaSegment (name, tags) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiToken = process.env.NEWSLETTER_API_TOKEN

  // Normalize tags to array
  const tagList = tags
    ? (Array.isArray(tags) ? tags : [tags])
    : null

  // Build filter: match contacts whose data.source contains any of the given tags
  const filter = tagList && tagList.length > 0
    ? { 'data.source': { $in: tagList } }
    : {} // all contacts (no filter)

  const body = JSON.stringify({
    data: {
      name,
      filter
    }
  })

  const response = await postRequest(actionUrl + '/api/v1/segments', body, 'json', null, null, apiToken)
  const data = JSON.parse(response)
  const segmentId = data.data ? data.data.id : null
  console.log(`Created Keila segment "${name}" (ID: ${segmentId}${tagList ? ', filter: ' + tagList.join(', ') : ''})`)
  return segmentId
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Main orchestrator: validates env, discovers files, parses, dispatches, summarizes.
 */
async function importSubscribers (options) {
  const { importPath, listId, dryRun, contentDir, activeOnly, tag, createList, splitCustomers } = options
  const provider = (process.env.NEWSLETTER_PROVIDER || '').toLowerCase()

  // Validate env vars
  const missing = validateEnvVars(provider)
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  // Auto-create list if requested
  let targetList = listId
  if (createList && !dryRun) {
    if (provider === 'listmonk' && !splitCustomers) {
      // Single list mode — create now (split mode creates lists later)
      targetList = await createListmonkList(createList)
    } else if (provider === 'keila') {
      // Keila doesn't have lists — segments are created after import
      console.log(`Keila uses segments, not lists. Segment "${createList}" will be created after import.`)
    } else if (provider === 'sendy') {
      console.warn('Sendy does not support list creation via API. Create the list manually and use --list <id>.')
    }
  } else if (!targetList && provider !== 'keila') {
    targetList = process.env.NEWSLETTER_LIST_ID
  }

  // Resolve import path
  const resolvedPath = importPath === true || !importPath
    ? path.join(contentDir || './content', 'newsletter', 'import')
    : importPath

  // Discover CSV files
  const csvFiles = await discoverCsvFiles(resolvedPath)
  if (csvFiles.length === 0) {
    console.error(`No CSV files found at ${resolvedPath}`)
    process.exit(1)
  }

  let allResults = []

  // Step 1: Parse all CSV files and collect records
  let allRecords = []
  for (const file of csvFiles) {
    console.log(`\nParsing ${path.basename(file)}...`)
    const records = await parseCsvFile(file)
    if (records.length === 0) {
      console.log('  No valid records found.')
      continue
    }
    console.log(`  ${records.length} record(s) parsed.`)
    for (const r of records) {
      r._source = path.basename(file)
    }
    allRecords = allRecords.concat(records)
  }

  if (allRecords.length === 0) {
    console.log('\nNo valid records to import across all files.')
    return
  }

  // Step 2: Deduplicate by email — most restrictive status wins, prefer non-empty name
  const STATUS_RANK = { active: 0, unconfirmed: 1, unsubscribed: 2, bounced: 3 }
  const deduped = new Map()
  for (const record of allRecords) {
    const key = record.email.toLowerCase()
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, { ...record, email: record.email })
    } else {
      // Most restrictive status wins
      const existingRank = STATUS_RANK[existing.status] || 0
      const newRank = STATUS_RANK[record.status] || 0
      if (newRank > existingRank) {
        existing.status = record.status
      }
      // Prefer non-empty name; when both have names, prefer the longer/more complete one
      if (!existing.name && record.name) {
        existing.name = record.name
      } else if (existing.name && record.name && record.name.length > existing.name.length) {
        existing.name = record.name
      }
      // Merge autoTags: upgrade subscriber → customer if any source says customer
      if (record.autoTag === 'customer') {
        existing.autoTag = 'customer'
      } else if (!existing.autoTag && record.autoTag) {
        existing.autoTag = record.autoTag
      }
      // Track sources
      existing._source = existing._source + ', ' + record._source
    }
  }

  let records = [...deduped.values()]
  const dupeCount = allRecords.length - records.length
  console.log(`\nTotal: ${allRecords.length} records from ${csvFiles.length} file(s), ${records.length} unique emails${dupeCount > 0 ? ` (${dupeCount} duplicates merged)` : ''}.`)

  // Step 3a: Always skip unconfirmed (never completed double opt-in = no GDPR consent)
  {
    const before = records.length
    records = records.filter(r => r.status !== 'unconfirmed')
    const filtered = before - records.length
    if (filtered > 0) {
      console.log(`Skipped ${filtered} unconfirmed record(s) (never completed double opt-in)`)
    }
  }

  // Step 3b: Filter active-only if requested
  if (activeOnly) {
    const before = records.length
    records = records.filter(r => r.status === 'active')
    const filtered = before - records.length
    if (filtered > 0) {
      console.log(`Filtered ${filtered} non-active record(s) (--active-only)`)
    }
  }

  if (records.length === 0) {
    console.log('No records to import after filtering.')
    return
  }

  // Step 4: Import deduplicated records
  if (splitCustomers && provider === 'listmonk') {
    // Split into two lists: subscribers and customers
    const subscribers = records.filter(r => r.autoTag !== 'customer')
    const customers = records.filter(r => r.autoTag === 'customer')

    let subscriberListId = targetList
    let customerListId = null

    if (createList && !dryRun) {
      subscriberListId = await createListmonkList(createList)
      customerListId = await createListmonkList(createList + ' — Customers')
    }

    let allImportResults = []
    if (subscribers.length > 0) {
      console.log(`\nImporting ${subscribers.length} subscriber(s) to list "${createList || 'default'}"...`)
      const subResults = await importToListmonk(subscribers, subscriberListId, dryRun)
      allImportResults = allImportResults.concat(subResults)
    }
    if (customers.length > 0 && customerListId) {
      console.log(`\nImporting ${customers.length} customer(s) to list "${createList} — Customers"...`)
      const custResults = await importToListmonk(customers, customerListId, dryRun)
      allImportResults = allImportResults.concat(custResults)
    } else if (customers.length > 0) {
      // No separate customer list — import to same list
      console.log(`\nImporting ${customers.length} customer(s) to same list...`)
      const custResults = await importToListmonk(customers, subscriberListId, dryRun)
      allImportResults = allImportResults.concat(custResults)
    }
    allResults = allImportResults
  } else if (splitCustomers && provider === 'keila') {
    // Keila: import all into one pool, create segments after
    console.log(`\nImporting ${records.length} contact(s) to Keila...`)
    allResults = await importToKeila(records, dryRun, tag)
  } else {
    // Standard single-list import
    console.log(`\nImporting ${records.length} subscriber(s) to ${provider}...`)
    let results
    if (provider === 'sendy') {
      results = await importToSendy(records, targetList, dryRun)
    } else if (provider === 'listmonk') {
      results = await importToListmonk(records, targetList, dryRun)
    } else if (provider === 'keila') {
      results = await importToKeila(records, dryRun, tag)
    } else {
      console.error(`Unknown newsletter provider: ${provider}`)
      process.exit(1)
    }
    allResults = results
  }

  if (allResults.length > 0) {
    if (dryRun) console.log('\n(dry run)')
    logSummary(allResults)
  }

  // Create segments/lists after import
  if (!dryRun && allResults.length > 0) {
    if (provider === 'keila') {
      if (splitCustomers) {
        // Create two segments: subscribers and customers
        const listName = createList || 'Newsletter'
        try {
          await createKeilaSegment(listName + ' — Subscribers', 'subscriber')
          await createKeilaSegment(listName + ' — Customers', 'customer')
        } catch (err) {
          console.warn(`Warning: failed to create Keila segments: ${err.message}`)
        }
      } else if (createList) {
        // Create a single segment — filter by tag if provided, otherwise include all tagged contacts
        const segmentTags = tag || ['subscriber', 'customer']
        try {
          await createKeilaSegment(createList, segmentTags)
        } catch (err) {
          console.warn(`Warning: failed to create Keila segment "${createList}": ${err.message}`)
        }
      }
    }
  }
}

module.exports = {
  parseCsvFile,
  parseCsvLine,
  discoverCsvFiles,
  isBandcampCsv,
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
  logSummary,
  importSubscribers,
  createListmonkList,
  createKeilaSegment,
  sleep
}
