'use strict'

const { marked } = require('marked')
const DOMPurify = require('isomorphic-dompurify')

function renderMarkdown (mdString) {
  if (mdString == null) return ''
  const html = marked.parse(mdString)
  return DOMPurify.sanitize(html)
}

module.exports.renderMarkdown = renderMarkdown
