'use strict'

const { marked } = require('marked')
const DOMPurify = require('isomorphic-dompurify')

// Extract own domain from SITE_URL for internal link detection
// Matches both example.com and www.example.com
let _ownDomain = null
const siteUrl = (process.env.SITE_URL || '').trim()
if (siteUrl) {
  try {
    const hostname = new URL(siteUrl).hostname
    _ownDomain = hostname.replace(/^www\./, '')
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
