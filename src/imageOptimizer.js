'use strict'

const fs = require('fs/promises')
const path = require('path')
const sharp = require('sharp')

const MAX_WIDTH = 1200
const WEBP_QUALITY = 80

/**
 * Optimizes images in the output directory:
 * - Resizes to max 1200px width (preserves aspect ratio)
 * - Converts to WebP format
 * - Keeps original as fallback
 *
 * @param {string} outputDir - The dist/ directory
 */
async function optimizeImages (outputDir) {
  const imageExts = new Set(['.jpg', '.jpeg', '.png'])
  let optimized = 0
  let skipped = 0
  let totalSaved = 0

  async function processDir (dir) {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await processDir(fullPath)
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      if (!imageExts.has(ext)) continue

      // Skip if WebP already exists
      const webpPath = fullPath.replace(/\.(jpg|jpeg|png)$/i, '.webp')
      try {
        await fs.access(webpPath)
        skipped++
        continue
      } catch { /* doesn't exist, proceed */ }

      try {
        const input = await fs.readFile(fullPath)
        const image = sharp(input)
        const metadata = await image.metadata()

        // Resize if wider than MAX_WIDTH
        const resizeOpts = metadata.width > MAX_WIDTH ? { width: MAX_WIDTH } : {}

        // Create WebP version
        const webpBuffer = await image
          .resize(resizeOpts)
          .webp({ quality: WEBP_QUALITY })
          .toBuffer()

        await fs.writeFile(webpPath, webpBuffer)

        // Also resize the original if it was too large
        if (metadata.width > MAX_WIDTH) {
          const resizedBuffer = await sharp(input)
            .resize({ width: MAX_WIDTH })
            .toBuffer()
          await fs.writeFile(fullPath, resizedBuffer)
        }

        const saved = input.length - webpBuffer.length
        totalSaved += Math.max(0, saved)
        optimized++
      } catch (err) {
        console.warn(`  [images] Could not optimize ${entry.name}: ${err.message}`)
      }
    }
  }

  await processDir(outputDir)

  console.log(`[images] Optimized ${optimized} image(s), skipped ${skipped} (already done). Saved ~${Math.round(totalSaved / 1024)}KB.`)
}

module.exports = { optimizeImages }
