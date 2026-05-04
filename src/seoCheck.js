'use strict'
const fs = require('fs')
const path = require('path')

/**
 * Checks a single HTML file for SEO basics.
 * Returns null for redirect pages, or an array of issue strings.
 * @param {string} file - Path to HTML file
 * @returns {string[]|null}
 */
function checkHtml (file) {
  const html = fs.readFileSync(file, 'utf8')
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

/**
 * Recursively finds all index.html files in a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir (dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkDir(full))
    else if (entry.name === 'index.html') files.push(full)
  }
  return files
}

/**
 * Runs SEO validation on the generated dist/ folder.
 * @param {string} distDir - Path to dist/ directory
 * @param {object} [options]
 * @param {boolean} [options.strict] - If true, returns non-zero on any issue
 * @returns {{ ok: number, issues: number, redirects: number, sitemapUrls: number, hasRobotsSitemap: boolean, details: Array }}
 */
function runSeoCheck (distDir, options = {}) {
  const allPages = walkDir(distDir)
  let ok = 0
  let issues = 0
  let redirects = 0
  const details = []

  for (const p of allPages) {
    const result = checkHtml(p)
    if (result === null) {
      redirects++
    } else if (result.length) {
      details.push({ file: p.replace(/\\/g, '/'), issues: result })
      issues++
    } else {
      ok++
    }
  }

  // Sitemap check
  let sitemapUrls = 0
  const sitemapPath = path.join(distDir, 'sitemap.xml')
  if (fs.existsSync(sitemapPath)) {
    const sitemap = fs.readFileSync(sitemapPath, 'utf8')
    sitemapUrls = (sitemap.match(/<loc>/g) || []).length
  }

  // Robots.txt check
  let hasRobotsSitemap = false
  const robotsPath = path.join(distDir, 'robots.txt')
  if (fs.existsSync(robotsPath)) {
    const robots = fs.readFileSync(robotsPath, 'utf8')
    hasRobotsSitemap = robots.includes('Sitemap:')
  }

  return { ok, issues, redirects, sitemapUrls, hasRobotsSitemap, details }
}

/**
 * Prints SEO check results to console.
 * @param {object} result - Output from runSeoCheck
 */
function printSeoReport (result) {
  console.log('\n--- SEO Check ---')
  console.log(`  Pages scanned: ${result.ok + result.issues + result.redirects}`)
  console.log(`  ${result.ok ? '✓' : '✖'} ${result.ok} pages OK`)
  if (result.issues) {
    console.log(`  ⚠ ${result.issues} pages with issues:`)
    for (const d of result.details.slice(0, 10)) {
      console.log(`    ${d.file} → ${d.issues.join(', ')}`)
    }
    if (result.details.length > 10) {
      console.log(`    ... and ${result.details.length - 10} more`)
    }
  }
  if (result.redirects) console.log(`  ○ ${result.redirects} redirects skipped`)
  console.log(`  ${result.sitemapUrls ? '✓' : '⚠'} Sitemap: ${result.sitemapUrls} URLs`)
  console.log(`  ${result.hasRobotsSitemap ? '✓' : '⚠'} Robots.txt: ${result.hasRobotsSitemap ? 'has' : 'MISSING'} sitemap reference`)
}

module.exports = { runSeoCheck, printSeoReport }
