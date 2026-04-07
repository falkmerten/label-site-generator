#!/usr/bin/env node
'use strict'

/**
 * Parses CHANGELOG.md from master and updates the changelog section
 * in the gh-pages index.html, then commits and pushes.
 *
 * Usage: node scripts/update-lsg-site.js
 */

const { execSync } = require('child_process')
const fs = require('fs')

function run (cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

// ── Parse CHANGELOG.md from current branch ──────────────────────────────────
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8')

const releases = []
const versionRegex = /^### (v[\d.]+)\s*[—–-]\s*(.+)$/gm
let match
const versionPositions = []

while ((match = versionRegex.exec(changelog)) !== null) {
  versionPositions.push({ version: match[1], date: match[2].trim(), index: match.index, end: versionRegex.lastIndex })
}

for (let i = 0; i < versionPositions.length; i++) {
  const { version, date, end } = versionPositions[i]
  const nextStart = i + 1 < versionPositions.length ? versionPositions[i + 1].index : changelog.length
  const body = changelog.slice(end, nextStart)

  // Extract bullet points — only top-level "- " lines, skip sub-headers and blank lines
  const items = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) {
      let text = trimmed.slice(2)
      // Convert inline code `...` to <code>...</code>
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
      // Strip markdown links [text](url) → text
      text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Strip bold **text** → text
      text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
      items.push(text)
    }
  }

  if (items.length > 0) {
    releases.push({ version, date, items })
  }
}

if (releases.length === 0) {
  console.error('No releases found in CHANGELOG.md')
  process.exit(1)
}

// Format date: "2026-04-07" → "7 April 2026"
function formatDate (dateStr) {
  const d = new Date(dateStr.trim())
  if (isNaN(d.getTime())) return dateStr.trim()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Build HTML ──────────────────────────────────────────────────────────────
const latestVersion = releases[0].version

let html = ''
for (const rel of releases) {
  const dateFormatted = formatDate(rel.date)
  html += `      <div class="release">\n`
  html += `        <h3>${rel.version} <span class="release-date">— ${dateFormatted}</span></h3>\n`
  html += `        <ul>\n`
  for (const item of rel.items) {
    html += `          <li>${item}</li>\n`
  }
  html += `        </ul>\n`
  html += `      </div>\n`
}

// ── Update gh-pages ─────────────────────────────────────────────────────────
const currentBranch = run('git rev-parse --abbrev-ref HEAD')
console.log(`Current branch: ${currentBranch}`)
console.log(`Parsed ${releases.length} release(s), latest: ${latestVersion}`)

// Stash any uncommitted changes
let stashed = false
try {
  const status = run('git status --porcelain')
  if (status) {
    run('git stash push -m "update-lsg-site auto-stash"')
    stashed = true
  }
} catch { /* clean working tree */ }

try {
  run('git checkout gh-pages')

  const indexPath = 'index.html'
  let indexHtml = fs.readFileSync(indexPath, 'utf8')

  // Replace changelog section content
  const changelogStart = indexHtml.indexOf('<div class="changelog">')
  const changelogEnd = indexHtml.indexOf('</div>', indexHtml.indexOf('</div>', changelogStart + 1))
  // Find the closing </div> that matches the changelog div — it's after all release divs
  // More robust: find all content between <div class="changelog"> and its closing </div>
  const startTag = '<div class="changelog">'
  const startIdx = indexHtml.indexOf(startTag)
  if (startIdx === -1) {
    console.error('Could not find <div class="changelog"> in index.html')
    process.exit(1)
  }

  // Find the matching closing </div> by counting nesting
  let depth = 1
  let pos = startIdx + startTag.length
  while (depth > 0 && pos < indexHtml.length) {
    const nextOpen = indexHtml.indexOf('<div', pos)
    const nextClose = indexHtml.indexOf('</div>', pos)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      pos = nextOpen + 4
    } else {
      depth--
      if (depth === 0) {
        // Replace content between startTag and this closing </div>
        const newContent = `${startTag}\n${html}    `
        indexHtml = indexHtml.slice(0, startIdx) + newContent + indexHtml.slice(nextClose)
        break
      }
      pos = nextClose + 6
    }
  }

  // Update footer version
  indexHtml = indexHtml.replace(
    /Label Site Generator v[\d.]+ —/,
    `Label Site Generator ${latestVersion} —`
  )

  fs.writeFileSync(indexPath, indexHtml)
  console.log('Updated index.html')

  run('git add index.html')
  run(`git commit -m "Update changelog to ${latestVersion}"`)
  run('git push origin gh-pages')
  console.log(`Pushed gh-pages with ${latestVersion}`)
} finally {
  // Always return to original branch
  run(`git checkout ${currentBranch}`)
  if (stashed) {
    try { run('git stash pop') } catch { /* nothing to pop */ }
  }
}

console.log('Done.')
