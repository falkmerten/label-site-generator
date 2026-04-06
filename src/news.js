'use strict'

const fs = require('fs/promises')
const path = require('path')
const { renderMarkdown } = require('./markdown')

/**
 * Loads news articles from content/news/{year}/MM-DD-slug.md files.
 * Returns articles sorted by date descending (newest first).
 *
 * @param {string} contentDir - path to content directory
 * @returns {Promise<Array>} array of news article objects
 */
async function loadNews (contentDir) {
  const newsDir = path.join(contentDir, 'news')
  const articles = []

  let yearDirs
  try {
    yearDirs = await fs.readdir(newsDir, { withFileTypes: true })
  } catch {
    return [] // no news folder
  }

  for (const yearEntry of yearDirs) {
    if (!yearEntry.isDirectory()) continue
    const year = yearEntry.name
    if (!/^\d{4}$/.test(year)) continue

    const yearPath = path.join(newsDir, year)
    let files
    try {
      files = await fs.readdir(yearPath, { withFileTypes: true })
    } catch { continue }

    for (const file of files) {
      if (!file.isFile()) continue
      const ext = path.extname(file.name).toLowerCase()
      if (ext !== '.md' && ext !== '.docx') continue

      const basename = path.basename(file.name, ext)
      const match = basename.match(/^(\d{2})-(\d{2})-(.+)$/)
      if (!match) continue

      const [, month, day, slug] = match
      const date = `${year}-${month}-${day}`
      const filePath = path.join(yearPath, file.name)

      try {
        let md
        if (ext === '.docx') {
          const mammoth = require('mammoth')
          const result = await mammoth.convertToMarkdown({ path: filePath })
          md = result.value
        } else {
          md = await fs.readFile(filePath, 'utf8')
        }

        const article = parseArticle(md, slug, date, yearPath)
        articles.push(article)
      } catch (err) {
        console.warn(`[news] Failed to load ${file.name}: ${err.message}`)
      }
    }
  }

  articles.sort((a, b) => b.date.localeCompare(a.date))
  return articles
}

/**
 * Parses a markdown string into a news article object.
 * Extracts front-matter, title, excerpt, and renders HTML.
 */
function parseArticle (md, slug, date, yearPath) {
  let frontMatter = {}
  let body = md

  // Parse front-matter
  const fmMatch = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (fmMatch) {
    body = md.slice(fmMatch[0].length)
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.+)$/)
      if (kv) frontMatter[kv[1].trim()] = kv[2].trim()
    }
  }

  // Extract title: front-matter > first heading > slug
  let title = frontMatter.title
  if (!title) {
    const headingMatch = body.match(/^#{1,2}\s+(.+)$/m)
    if (headingMatch) {
      title = headingMatch[1].trim()
      // Remove the heading from body so it's not duplicated
      body = body.replace(headingMatch[0], '').trim()
    }
  }
  if (!title) {
    title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  // Extract excerpt: front-matter > first paragraph > truncated body
  let excerpt = frontMatter.excerpt
  if (!excerpt) {
    // Find first non-empty paragraph (skip headings, blank lines)
    const lines = body.split('\n')
    const para = []
    let inPara = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (inPara) break
        continue
      }
      if (trimmed.startsWith('#')) continue
      if (trimmed.startsWith('![')) continue // skip images
      inPara = true
      para.push(trimmed)
    }
    excerpt = para.join(' ')
  }
  // Strip markdown formatting for plain text excerpt
  excerpt = excerpt
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[*_~`#]/g, '') // formatting
  // Strip HTML tags iteratively to prevent incomplete sanitization (e.g. <scr<script>ipt>)
  let prev = ''
  while (prev !== excerpt) {
    prev = excerpt
    excerpt = excerpt.replace(/<[^>]*>/g, '')
  }
  excerpt = excerpt.trim()
  if (excerpt.length > 300) {
    excerpt = excerpt.slice(0, 297) + '…'
  }

  // Image: front-matter > slug-based file auto-detection
  let image = frontMatter.image || null
  if (image && !image.startsWith('http')) {
    image = path.join(yearPath, image)
  }
  if (!image) {
    // Auto-detect: look for {slug}.jpg, .jpeg, .png, .webp in the year folder
    const fs = require('fs')
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      const candidates = [
        path.join(yearPath, slug + ext),
        path.join(yearPath, date.slice(5, 7) + '-' + date.slice(8, 10) + '-' + slug + ext)
      ]
      for (const candidate of candidates) {
        try {
          fs.accessSync(candidate)
          image = candidate
          break
        } catch { /* not found */ }
      }
      if (image) break
    }
  }

  // Render HTML
  const html = renderMarkdown(body)

  return {
    slug,
    date,
    title,
    excerpt,
    html,
    image,
    imagePath: image, // original path for copying
    yearPath
  }
}

module.exports = { loadNews, parseArticle }
