'use strict'

const fs = require('fs/promises')
const path = require('path')
const mammoth = require('mammoth')

/**
 * Converts a .docx file to Markdown-ish HTML using mammoth.
 * Writes output as bio.md next to the source file.
 * Skips if bio.md already exists and is newer than bio.docx.
 *
 * @param {string} docxPath
 */
async function convertDocx (docxPath) {
  const dir = path.dirname(docxPath)
  const mdPath = path.join(dir, 'bio.md')

  // Skip if md is newer than docx
  try {
    const [docxStat, mdStat] = await Promise.all([fs.stat(docxPath), fs.stat(mdPath)])
    if (mdStat.mtimeMs >= docxStat.mtimeMs) return false
  } catch { /* md doesn't exist yet — proceed */ }

  const result = await mammoth.convertToMarkdown({ path: docxPath })
  await fs.writeFile(mdPath, result.value, 'utf8')
  if (result.messages.length > 0) {
    result.messages.forEach(m => console.warn(`  [docx] ${m.message}`))
  }
  return true
}

/**
 * Scans contentDir for any bio.docx files in artist folders and .docx files
 * in content/pages/, converts them to .md if newer than existing .md.
 *
 * @param {string} contentDir
 */
async function convertAllDocs (contentDir = './content') {
  let converted = 0
  let entries

  try {
    entries = await fs.readdir(contentDir, { withFileTypes: true })
  } catch {
    return
  }

  // Convert artist bio.docx files
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const docxPath = path.join(contentDir, entry.name, 'bio.docx')
    try {
      await fs.access(docxPath)
      const didConvert = await convertDocx(docxPath)
      if (didConvert) {
        console.log(`  ✓ Converted ${entry.name}/bio.docx → bio.md`)
        converted++
      }
    } catch { /* no bio.docx */ }
  }

  // Convert any .docx files in content/pages/
  const pagesDir = path.join(contentDir, 'pages')
  try {
    const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true })
    for (const entry of pageEntries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.docx') continue
      const docxPath = path.join(pagesDir, entry.name)
      const didConvert = await convertDocx(docxPath)
      if (didConvert) {
        console.log(`  ✓ Converted pages/${entry.name} → ${path.basename(entry.name, '.docx')}.md`)
        converted++
      }
    }
  } catch { /* pages dir doesn't exist */ }

  if (converted > 0) {
    console.log(`Converted ${converted} document(s).`)
  }
}

module.exports = { convertAllDocs, convertDocx }
