'use strict'

const fs = require('fs/promises')
const path = require('path')
const sharp = require('sharp')

const MAX_WIDTH = 1200
const MOBILE_WIDTH = 600
const WEBP_QUALITY = 80

/**
 * Optimizes images in the output directory:
 * - Resizes to max 1200px width (preserves aspect ratio)
 * - Creates mobile version at 600px width (-mobile suffix)
 * - Converts to WebP format (both full and mobile)
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

      // Skip mobile variants (already generated)
      if (entry.name.includes('-mobile.')) continue

      const baseName = path.basename(entry.name, ext)
      const webpPath = path.join(dir, baseName + '.webp')
      const mobilePath = path.join(dir, baseName + '-mobile' + ext)
      const mobileWebpPath = path.join(dir, baseName + '-mobile.webp')

      // Check what already exists
      let hasWebp = false
      let hasMobile = false
      try { await fs.access(webpPath); hasWebp = true } catch { /* needs creating */ }
      try { await fs.access(mobileWebpPath); hasMobile = true } catch { /* needs creating */ }

      // Skip if WebP exists — mobile check happens after we know the image width
      if (hasWebp && hasMobile) {
        skipped++
        continue
      }

      try {
        const input = await fs.readFile(fullPath)
        const image = sharp(input)
        const metadata = await image.metadata()

        // Resize if wider than MAX_WIDTH
        const needsResize = metadata.width > MAX_WIDTH
        const resizeOpts = needsResize ? { width: MAX_WIDTH } : {}
        const effectiveWidth = needsResize ? MAX_WIDTH : metadata.width

        // If image is too small for mobile variant, only WebP matters for skip
        if (hasWebp && effectiveWidth <= MOBILE_WIDTH) {
          skipped++
          continue
        }

        // Create full-size WebP if missing
        if (!hasWebp) {
          const webpBuffer = await sharp(input)
            .resize(resizeOpts)
            .webp({ quality: WEBP_QUALITY })
            .toBuffer()
          await fs.writeFile(webpPath, webpBuffer)

          const saved = input.length - webpBuffer.length
          totalSaved += Math.max(0, saved)

          // Resize the original if too large
          if (needsResize) {
            const resizedBuffer = await sharp(input)
              .resize({ width: MAX_WIDTH })
              .toBuffer()
            await fs.writeFile(fullPath, resizedBuffer)
          }
        }

        // Create mobile versions if missing
        if (!hasMobile && effectiveWidth > MOBILE_WIDTH) {
          const mobileBuffer = await sharp(input)
            .resize({ width: MOBILE_WIDTH })
            .toBuffer()
          await fs.writeFile(mobilePath, mobileBuffer)

          const mobileWebpBuffer = await sharp(input)
            .resize({ width: MOBILE_WIDTH })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer()
          await fs.writeFile(mobileWebpPath, mobileWebpBuffer)
        }

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
