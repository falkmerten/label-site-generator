'use strict'

const https = require('https')
const http = require('http')
const DOMPurify = require('isomorphic-dompurify')

/**
 * Creates a Ghost Content API client.
 * If url or apiKey is falsy, all methods return empty results without HTTP requests.
 *
 * @param {Object} options
 * @param {string} options.url - Ghost instance URL (GHOST_URL)
 * @param {string} options.apiKey - Content API key (GHOST_CONTENT_API_KEY)
 * @returns {{ fetchPosts, fetchAllPosts, normalizePost }}
 */
function createGhostClient ({ url, apiKey } = {}) {
  const baseUrl = (url || '').replace(/\/+$/, '')
  const key = apiKey || ''

  /**
   * Makes a GET request to the Ghost Content API.
   * @param {string} endpoint - API path after /ghost/api/content/
   * @returns {Promise<Object>} Parsed JSON response
   */
  function apiGet (endpoint) {
    const separator = endpoint.includes('?') ? '&' : '?'
    const fullUrl = `${baseUrl}/ghost/api/content/${endpoint}${separator}key=${key}`

    return new Promise((resolve, reject) => {
      const mod = fullUrl.startsWith('https') ? https : http

      mod.get(fullUrl, (res) => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Ghost API returned ${res.statusCode}: ${raw.slice(0, 200)}`))
            return
          }
          try {
            resolve(JSON.parse(raw))
          } catch (err) {
            reject(new Error(`Ghost API returned invalid JSON: ${err.message}`))
          }
        })
      }).on('error', (err) => {
        reject(new Error(`Ghost API request failed: ${err.message}`))
      })
    })
  }

  /**
   * Fetch a paginated list of posts.
   * @param {number} [page=1]
   * @param {number} [limit=15]
   * @returns {Promise<{ posts: Object[], meta: Object }>}
   */
  async function fetchPosts (page = 1, limit = 15) {
    if (!baseUrl || !key) return { posts: [], meta: { pagination: { page: 1, pages: 1, total: 0, next: null, prev: null } } }

    const data = await apiGet(`posts/?include=tags,authors&page=${page}&limit=${limit}`)
    return {
      posts: data.posts || [],
      meta: data.meta || { pagination: { page: 1, pages: 1, total: 0, next: null, prev: null } }
    }
  }

  /**
   * Fetch ALL published posts by auto-paginating.
   * Ghost 6.0 max page size is 100.
   * @returns {Promise<Object[]>}
   */
  async function fetchAllPosts () {
    if (!baseUrl || !key) return []

    const allPosts = []
    let page = 1
    const limit = 100

    while (true) {
      const data = await fetchPosts(page, limit)
      allPosts.push(...data.posts)

      if (!data.meta.pagination.next) break
      page = data.meta.pagination.next
    }

    return allPosts
  }

  return { fetchPosts, fetchAllPosts, apiGet }
}

/**
 * Normalizes a Ghost post into the News_Article format used by the renderer.
 * Matches the shape produced by src/news.js parseArticle().
 *
 * @param {Object} post - Raw Ghost post from the Content API
 * @returns {Object} News_Article compatible object
 */
function normalizePost (post) {
  // Sanitize HTML content
  const sanitizedHtml = DOMPurify.sanitize(post.html || '', {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'src']
  })

  // Generate excerpt: custom_excerpt > strip HTML from content
  let excerpt = post.custom_excerpt || post.excerpt || ''
  if (!excerpt && post.html) {
    // Strip HTML tags iteratively (prevents nested tag bypass like <scr<script>ipt>)
    excerpt = post.html || ''
    let prev = ''
    while (prev !== excerpt) {
      prev = excerpt
      excerpt = excerpt.replace(/<[^>]*>/g, '')
    }
    excerpt = excerpt.trim()
  }
  // Strip markdown formatting remnants
  excerpt = excerpt
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`#]/g, '')
  // Iterative HTML strip (same pattern as news.js)
  let prev = ''
  while (prev !== excerpt) {
    prev = excerpt
    excerpt = excerpt.replace(/<[^>]*>/g, '')
  }
  excerpt = excerpt.trim()
  if (excerpt.length > 300) {
    excerpt = excerpt.slice(0, 297) + '…'
  }

  // Format date to YYYY-MM-DD
  const publishedAt = post.published_at || ''
  const date = publishedAt ? publishedAt.slice(0, 10) : ''

  // Feature image — Ghost serves absolute URLs, use as-is
  const featureImage = post.feature_image || null

  return {
    slug: post.slug || '',
    date,
    title: post.title || '',
    excerpt,
    html: sanitizedHtml,
    image: featureImage,
    imageUrl: featureImage,
    imagePath: featureImage,
    // Extra Ghost-specific fields for templates
    reading_time: post.reading_time || 0,
    tags: post.tags || [],
    primary_tag: post.primary_tag || null,
    authors: post.authors || [],
    primary_author: post.primary_author || null,
    meta_title: post.meta_title || null,
    meta_description: post.meta_description || null,
    og_image: post.og_image || null,
    og_title: post.og_title || null,
    og_description: post.og_description || null,
    source: 'ghost'
  }
}

module.exports = { createGhostClient, normalizePost }
