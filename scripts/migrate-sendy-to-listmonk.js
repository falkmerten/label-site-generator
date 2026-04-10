#!/usr/bin/env node
'use strict'

/**
 * Migrate subscribers from Sendy (CSV export) to Listmonk.
 *
 * Usage:
 *   1. Export subscribers from Sendy Dashboard (View list → Export)
 *   2. Save as CSV file
 *   3. Configure .env with Listmonk credentials
 *   4. Run: node scripts/migrate-sendy-to-listmonk.js <csv-file> [--dry-run]
 *
 * CSV format expected (Sendy export):
 *   Name,Email,Status (or just Email per line)
 *
 * Environment variables (from .env):
 *   LISTMONK_URL          — Listmonk instance URL (e.g. https://mail.example.com)
 *   LISTMONK_API_USER     — Listmonk API username
 *   LISTMONK_API_TOKEN    — Listmonk API token
 *   LISTMONK_LIST_ID      — Listmonk list ID (numeric)
 *
 * LSG-32
 */

require('dotenv').config()
const fs = require('fs')
const https = require('https')
const http = require('http')

const DELAY_MS = 200

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseCSV (filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/).filter(l => l.trim())

  // Detect header
  const first = lines[0].toLowerCase()
  const hasHeader = first.includes('email') || first.includes('name') || first.includes('status')
  const dataLines = hasHeader ? lines.slice(1) : lines

  const subscribers = []
  for (const line of dataLines) {
    const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
    if (parts.length === 0) continue

    let name = ''
    let email = ''
    let status = 'Subscribed'

    if (parts.length === 1) {
      // Just email
      email = parts[0]
    } else if (parts.length === 2) {
      // Name, Email or Email, Status
      if (parts[0].includes('@')) {
        email = parts[0]
        status = parts[1] || 'Subscribed'
      } else {
        name = parts[0]
        email = parts[1]
      }
    } else {
      // Name, Email, Status (or more columns)
      name = parts[0]
      email = parts[1]
      status = parts[2] || 'Subscribed'
    }

    if (!email || !email.includes('@')) continue
    subscribers.push({ name, email, status })
  }

  return subscribers
}

function listmonkPost (endpoint, body) {
  const url = new URL(process.env.LISTMONK_URL + endpoint)
  const protocol = url.protocol === 'https:' ? https : http
  const data = JSON.stringify(body)
  const auth = Buffer.from(`${process.env.LISTMONK_API_USER}:${process.env.LISTMONK_API_TOKEN}`).toString('base64')

  return new Promise((resolve, reject) => {
    const req = protocol.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Basic ${auth}`
      }
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) })
        } catch {
          resolve({ status: res.statusCode, body: raw })
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function mapStatus (sendyStatus) {
  const s = (sendyStatus || '').toLowerCase()
  if (s === 'subscribed' || s === 'confirmed') return 'enabled'
  if (s === 'unsubscribed') return 'blocklisted'
  if (s === 'unconfirmed') return 'enabled' // will need opt-in
  if (s === 'bounced' || s === 'soft bounced') return 'blocklisted'
  if (s === 'complained') return 'blocklisted'
  return 'enabled'
}

async function migrate (csvPath, dryRun) {
  // Validate env
  const required = ['LISTMONK_URL', 'LISTMONK_API_USER', 'LISTMONK_API_TOKEN', 'LISTMONK_LIST_ID']
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing env var: ${key}`)
      process.exit(1)
    }
  }

  const listId = parseInt(process.env.LISTMONK_LIST_ID, 10)
  if (isNaN(listId)) {
    console.error('LISTMONK_LIST_ID must be a numeric list ID')
    process.exit(1)
  }

  // Parse CSV
  const subscribers = parseCSV(csvPath)
  console.log(`Parsed ${subscribers.length} subscriber(s) from ${csvPath}`)

  const stats = { created: 0, skipped: 0, failed: 0, blocklisted: 0 }

  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i]
    const status = mapStatus(sub.status)
    const label = `[${i + 1}/${subscribers.length}]`

    if (dryRun) {
      console.log(`${label} DRY-RUN: ${sub.email} (${sub.name || 'no name'}) → status: ${status}`)
      stats.created++
      continue
    }

    try {
      await delay(DELAY_MS)
      const result = await listmonkPost('/api/subscribers', {
        email: sub.email,
        name: sub.name || '',
        status,
        lists: [listId],
        preconfirm_subscriptions: true
      })

      if (result.status === 200 || result.status === 201) {
        console.log(`${label} ✓ ${sub.email} → created (${status})`)
        stats.created++
        if (status === 'blocklisted') stats.blocklisted++
      } else if (result.status === 409) {
        console.log(`${label} – ${sub.email} → already exists, skipped`)
        stats.skipped++
      } else {
        const msg = result.body && result.body.message ? result.body.message : JSON.stringify(result.body).slice(0, 100)
        console.warn(`${label} ✗ ${sub.email} → HTTP ${result.status}: ${msg}`)
        stats.failed++
      }
    } catch (err) {
      console.warn(`${label} ✗ ${sub.email} → ${err.message}`)
      stats.failed++
    }
  }

  console.log(`\n--- Migration ${dryRun ? '(DRY RUN) ' : ''}complete ---`)
  console.log(`Created: ${stats.created}`)
  console.log(`Skipped (already exists): ${stats.skipped}`)
  console.log(`Blocklisted: ${stats.blocklisted}`)
  console.log(`Failed: ${stats.failed}`)
  console.log(`Total: ${subscribers.length}`)
}

// CLI
const args = process.argv.slice(2)
const csvPath = args.find(a => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')

if (!csvPath) {
  console.log('Usage: node scripts/migrate-sendy-to-listmonk.js <csv-file> [--dry-run]')
  console.log('')
  console.log('Environment variables (in .env):')
  console.log('  LISTMONK_URL          Listmonk instance URL')
  console.log('  LISTMONK_API_USER     Listmonk API username')
  console.log('  LISTMONK_API_TOKEN    Listmonk API token')
  console.log('  LISTMONK_LIST_ID      Listmonk list ID (numeric)')
  process.exit(0)
}

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`)
  process.exit(1)
}

migrate(csvPath, dryRun).catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
