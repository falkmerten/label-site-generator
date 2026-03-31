'use strict'

const fs = require('fs/promises')
const path = require('path')

/**
 * Generates HTML redirect pages for each entry in content/redirects.json.
 * Each old path gets an index.html with a meta refresh + canonical link.
 *
 * Format of redirects.json:
 * {
 *   "/old-path": "/new-path/",
 *   "/another-old": "https://external.url/"
 * }
 *
 * @param {string} contentDir
 * @param {string} outputDir
 * @returns {Promise<number>} number of redirects written
 */
async function generateRedirects (contentDir, outputDir) {
  const redirectsPath = path.join(contentDir, 'redirects.json')
  let redirects
  try {
    const raw = await fs.readFile(redirectsPath, 'utf8')
    redirects = JSON.parse(raw)
  } catch {
    return 0 // no redirects file — skip silently
  }

  let count = 0
  for (const [from, to] of Object.entries(redirects)) {
    // Strip leading slash, use as directory path
    const slug = from.replace(/^\//, '').replace(/\/$/, '')
    if (!slug) continue

    const dir = path.join(outputDir, slug)
    await fs.mkdir(dir, { recursive: true })

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${to}">
  <link rel="canonical" href="${to}">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to <a href="${to}">${to}</a>...</p>
  <script>window.location.replace(${JSON.stringify(to)});</script>
</body>
</html>`

    await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8')
    count++
  }

  if (count > 0) console.log(`Generated ${count} redirect(s).`)
  return count
}

module.exports = { generateRedirects }
