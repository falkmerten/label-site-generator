'use strict'

const { marked } = require('marked')
const DOMPurify = require('isomorphic-dompurify')

// Custom renderer: external links open in new tab
const renderer = new marked.Renderer()
const originalLink = renderer.link.bind(renderer)
renderer.link = function (href, title, text) {
  // Handle both old (positional) and new (object) marked API
  const h = typeof href === 'object' ? href.href : href
  const t = typeof href === 'object' ? href.title : title
  const tx = typeof href === 'object' ? href.text : text
  const html = originalLink.call ? originalLink(href, title, text) : `<a href="${h}">${tx}</a>`
  if (h && (h.startsWith('http://') || h.startsWith('https://'))) {
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
