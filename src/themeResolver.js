'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Computes luminance from a hex color string (simple average of R, G, B).
 * @param {string} hex - e.g. '#0c0032' or '0c0032' or 'abc'
 * @returns {number} luminance 0-255
 */
function hexLuminance (hex) {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return Math.round((r + g + b) / 3)
}

/**
 * Lighten a hex color by adding `amount` to each RGB channel (capped at 255).
 * @param {string} hex - e.g. '#0c0032'
 * @param {number} amount - amount to add to each channel
 * @returns {string} hex string with '#' prefix
 */
function lightenHex (hex, amount) {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + amount)
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + amount)
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + amount)
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

/**
 * Generates CSS custom property override block from color values.
 * Pure function — no I/O.
 * @param {object} colors - merged color values { background?, body?, text?, secondary?, link?, nav?, button? }
 * @returns {string} CSS :root block with overrides (or empty string if no colors)
 */
function generateColorOverrides (colors) {
  if (!colors || typeof colors !== 'object') return ''

  const overrides = []

  if (colors.background) {
    overrides.push(`  --page: ${colors.background};`)
    overrides.push(`  --muted-block: ${colors.background};`)

    const lum = hexLuminance(colors.background)
    if (lum < 128) {
      // Dark background: derive panel and line from background
      overrides.push(`  --panel: ${lightenHex(colors.background, 20)};`)
      overrides.push(`  --panel-strong: ${lightenHex(colors.background, 30)};`)
      overrides.push(`  --line: ${lightenHex(colors.background, 40)};`)
      overrides.push(`  --line-strong: ${lightenHex(colors.background, 55)};`)
      overrides.push('  --button-text: #151515;')
    } else {
      overrides.push('  --button-text: #ffffff;')
    }
  }

  if (colors.body) {
    overrides.push(`  --body: ${colors.body};`)
    overrides.push(`  --panel: ${colors.body};`)
  }

  if (colors.text) {
    overrides.push(`  --text: ${colors.text};`)
  }

  if (colors.secondary) {
    overrides.push(`  --secondary: ${colors.secondary};`)
  }

  if (colors.link) {
    overrides.push(`  --link: ${colors.link};`)
    overrides.push(`  --button: ${colors.link};`)
    overrides.push(`  --accent: ${colors.link};`)
    overrides.push(`  --accent-hover: ${colors.link};`)
    overrides.push(`  --brand-accent: ${colors.link};`)
  }

  if (colors.nav) {
    overrides.push(`  --nav: ${colors.nav};`)
  }

  if (colors.button) {
    overrides.push(`  --brand-mid: ${colors.button};`)
  }

  if (overrides.length === 0) return ''
  return `\n/* Bandcamp theme color overrides */\n:root {\n${overrides.join('\n')}\n}\n`
}

/**
 * Resolves the theme CSS based on theme name, colors, and environment overrides.
 * @param {string} themeName - 'standard' | 'dark' | 'bandcamp' (from SITE_THEME)
 * @param {object} themeColors - { background?, text?, link?, button?, body?, secondary?, nav? } from data.themeColors
 * @param {object} envOverrides - { background?, text?, link? } from THEME_COLOR_* env vars
 * @param {string} themesDir - path to templates/themes/ directory
 * @returns {{ css: string, resolvedTheme: string, warnings: string[] }}
 */
function resolveTheme (themeName, themeColors, envOverrides, themesDir) {
  const warnings = []

  // Default to 'standard' when themeName is empty/undefined
  if (!themeName || typeof themeName !== 'string' || themeName.trim() === '') {
    themeName = 'standard'
  } else {
    themeName = themeName.trim().toLowerCase()
  }

  // Resolve the themes directory
  if (!themesDir) {
    themesDir = path.join(__dirname, '..', 'templates', 'themes')
  }

  // For bandcamp theme: always start with standard.css as base
  if (themeName === 'bandcamp') {
    const standardPath = path.join(themesDir, 'standard.css')
    let baseCss
    try {
      baseCss = fs.readFileSync(standardPath, 'utf8')
    } catch (err) {
      warnings.push(`[themeResolver] Could not read standard.css as base for bandcamp theme: ${err.message}`)
      return { css: '', resolvedTheme: 'standard', warnings }
    }

    // Merge themeColors with envOverrides (env vars take precedence)
    const mergedColors = Object.assign({}, themeColors || {}, envOverrides || {})

    // If no colors available, fall back to plain standard.css
    const hasColors = Object.keys(mergedColors).some(k => mergedColors[k])
    if (!hasColors) {
      warnings.push('[themeResolver] SITE_THEME=bandcamp but no theme colors available. Using plain standard theme.')
      return { css: baseCss, resolvedTheme: 'standard', warnings }
    }

    // Generate color overrides and append to base CSS
    const overrideBlock = generateColorOverrides(mergedColors)
    const css = baseCss + overrideBlock

    return { css, resolvedTheme: 'bandcamp', warnings }
  }

  // For standard/dark or any other theme: try to read the CSS file
  const themePath = path.join(themesDir, `${themeName}.css`)
  let css
  try {
    css = fs.readFileSync(themePath, 'utf8')
  } catch (err) {
    // File not found or unrecognized theme name — fall back to standard.css
    if (themeName === 'custom') {
      warnings.push(`[themeResolver] site.theme is "custom" but no custom.css found in ${themesDir}. Using standard theme. Create templates/themes/custom.css or set a SITE_TEMPLATE directory with style.css.`)
    } else {
      warnings.push(`[themeResolver] Theme "${themeName}" not found (${err.message}). Falling back to standard theme.`)
    }
    const standardPath = path.join(themesDir, 'standard.css')
    try {
      css = fs.readFileSync(standardPath, 'utf8')
    } catch (fallbackErr) {
      warnings.push(`[themeResolver] Could not read standard.css fallback: ${fallbackErr.message}`)
      css = ''
    }
    return { css, resolvedTheme: 'standard', warnings }
  }

  return { css, resolvedTheme: themeName, warnings }
}

/**
 * Lists available theme names by scanning the themes directory.
 * @param {string} themesDir - path to templates/themes/
 * @returns {string[]} e.g. ['standard', 'dark', 'bandcamp']
 */
function listAvailableThemes (themesDir) {
  if (!themesDir) {
    themesDir = path.join(__dirname, '..', 'templates', 'themes')
  }
  try {
    const files = fs.readdirSync(themesDir)
    return files
      .filter(f => f.endsWith('.css'))
      .map(f => f.replace(/\.css$/, ''))
  } catch (err) {
    return []
  }
}

/**
 * Formats CSS with consistent indentation.
 * Trims trailing whitespace from each line and ensures a newline at end.
 * @param {string} css - raw CSS string
 * @returns {string} formatted CSS
 */
function formatCss (css) {
  if (!css || typeof css !== 'string') return ''
  const lines = css.split('\n')
  const formatted = lines
    .map(line => line.trimEnd())
    .join('\n')
  // Ensure newline at end
  if (formatted.length > 0 && !formatted.endsWith('\n')) {
    return formatted + '\n'
  }
  return formatted
}

module.exports = {
  resolveTheme,
  generateColorOverrides,
  hexLuminance,
  lightenHex,
  listAvailableThemes,
  formatCss
}
