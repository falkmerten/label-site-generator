'use strict'
const fs = require('fs')
const path = require('path')

function checkHtml (file) {
  const html = fs.readFileSync(file, 'utf8')
  // Skip redirect pages (meta http-equiv="refresh")
  if (html.includes('http-equiv="refresh"')) return null
  const issues = []
  if (!html.includes('<meta name="description"')) issues.push('missing meta description')
  if (!html.includes('og:title')) issues.push('missing og:title')
  if (!html.includes('og:description')) issues.push('missing og:description')
  if (!html.includes('og:image')) issues.push('missing og:image')
  if (!html.includes('twitter:card')) issues.push('missing twitter:card')
  if (!html.includes('rel="canonical"')) issues.push('missing canonical')
  if (!html.includes('application/ld+json')) issues.push('missing JSON-LD')
  if (!html.includes('lang="en"')) issues.push('missing lang attribute')
  return issues
}

function walkDir (dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkDir(full))
    else if (entry.name === 'index.html') files.push(full)
  }
  return files
}

// Check all pages
const allPages = walkDir('dist')
let okCount = 0
let issueCount = 0
let redirectCount = 0

for (const p of allPages) {
  const issues = checkHtml(p)
  if (issues === null) {
    redirectCount++
  } else if (issues.length) {
    console.log(p.replace(/\\/g, '/'), '→', issues.join(', '))
    issueCount++
  } else {
    okCount++
  }
}

console.log('\n' + okCount + ' pages OK, ' + issueCount + ' with issues, ' + redirectCount + ' redirects skipped')

// Check sitemap
const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8')
const urlCount = (sitemap.match(/<loc>/g) || []).length
console.log('Sitemap: ' + urlCount + ' URLs')

// Check robots.txt
const robots = fs.readFileSync('dist/robots.txt', 'utf8')
console.log('Robots.txt: ' + (robots.includes('Sitemap:') ? 'has sitemap reference' : 'MISSING sitemap reference'))
