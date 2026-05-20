'use strict'

const { marked } = require('marked')
const DOMPurify = require('isomorphic-dompurify')

// Own domain for internal link detection — can be set via configure() or falls back to SITE_URL env
let _ownDomain = null

/**
 * Configure the markdown renderer with site settings.
 * Call this once before rendering to avoid process.env dependency.
 *
 * @param {object} options
 * @param {string} [options.siteUrl] - Site URL for internal link detection
 */
function configure (options) {
  options = options || {}
  const url = (options.siteUrl || '').trim()
  if (url) {
    try {
      _ownDomain = new URL(url).hostname.replace(/^www\./, '')
    } catch { /* invalid URL */ }
  }
}

// Fallback: read from process.env at module load (backward compat)
const _envSiteUrl = (process.env.SITE_URL || '').trim()
if (_envSiteUrl && !_ownDomain) {
  try {
    _ownDomain = new URL(_envSiteUrl).hostname.replace(/^www\./, '')
  } catch { /* invalid URL */ }
}

function isOwnDomain (href) {
  if (!_ownDomain || !href) return false
  try {
    const hostname = new URL(href).hostname.replace(/^www\./, '')
    return hostname === _ownDomain
  } catch { return false }
}

// Custom renderer: external links open in new tab
const renderer = new marked.Renderer()
const originalLink = renderer.link.bind(renderer)
renderer.link = function (href, title, text) {
  const h = typeof href === 'object' ? href.href : href
  const html = originalLink.call ? originalLink(href, title, text) : `<a href="${h}">${typeof href === 'object' ? href.text : text}</a>`
  if (h && (h.startsWith('http://') || h.startsWith('https://')) && !isOwnDomain(h)) {
    return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ')
  }
  return html
}

marked.setOptions({ renderer })

function renderMarkdown (mdString) {
  if (mdString == null) return ''
  const html = marked.parse(mdString)
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
}

module.exports.renderMarkdown = renderMarkdown
module.exports.configure = configure
