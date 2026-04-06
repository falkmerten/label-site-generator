'use strict'

const https = require('https')
const http = require('http')
const fs = require('fs/promises')
const path = require('path')
const querystring = require('querystring')
const nunjucks = require('nunjucks')

// Configure Nunjucks for newsletter template
const templatesDir = path.join(__dirname, '..', 'templates')
const njkEnv = nunjucks.configure(templatesDir, { autoescape: false })

njkEnv.addFilter('formatDate', (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
})

/**
 * Creates newsletter campaign drafts for new news articles.
 * Supports Sendy and Listmonk providers.
 *
 * @param {Array} articles - news article objects from loadNews()
 * @param {string} contentDir - content directory path
 * @returns {Promise<number>} number of campaigns created
 */
async function createCampaignDrafts (articles, contentDir) {
  const provider = (process.env.NEWSLETTER_PROVIDER || '').toLowerCase()
  if (!provider) return 0
  if (process.env.NEWSLETTER_AUTO_CAMPAIGN !== 'true') return 0

  const sentFile = path.join(contentDir, 'news', '.campaigns-created')
  let sentSlugs = new Set()
  try {
    const raw = await fs.readFile(sentFile, 'utf8')
    sentSlugs = new Set(raw.split('\n').map(s => s.trim()).filter(Boolean))
  } catch { /* file doesn't exist yet */ }

  const newArticles = articles.filter(a => !sentSlugs.has(a.slug))
  if (newArticles.length === 0) return 0

  const siteUrl = (process.env.SITE_URL || '').replace(/\/?$/, '/')
  const labelName = process.env.LABEL_NAME || 'Newsletter'
  let created = 0

  for (const article of newArticles) {
    try {
      const articleUrl = siteUrl ? `${siteUrl}news/${article.slug}/` : ''
      // Use original image path (not WebP) for email compatibility
      const imgBase = article.imagePath ? path.basename(article.imagePath) : (article.image ? path.basename(article.image) : '')
      const imageUrl = imgBase && siteUrl ? `${siteUrl}news/${article.slug}/${imgBase}` : ''

      const htmlBody = buildCampaignHtml(article, articleUrl, imageUrl, labelName, articles)
      const plainText = `${article.title}\n\n${article.excerpt}\n\nRead more: ${articleUrl}`

      if (provider === 'sendy') {
        await createSendyCampaign(article, htmlBody, plainText)
      } else if (provider === 'listmonk') {
        await createListmonkCampaign(article, htmlBody)
      }

      sentSlugs.add(article.slug)
      created++
      console.log(`  ✓ Campaign draft created: "${article.title}"`)
    } catch (err) {
      console.warn(`  ⚠ Campaign creation failed for "${article.title}": ${err.message}`)
    }
  }

  // Persist sent slugs
  if (created > 0) {
    await fs.mkdir(path.dirname(sentFile), { recursive: true })
    await fs.writeFile(sentFile, [...sentSlugs].join('\n') + '\n', 'utf8')
  }

  return created
}

/**
 * Builds HTML email body using the newsletter.njk template.
 * Includes full article HTML, feature image, and older news as CTA cards.
 */
function buildCampaignHtml (article, articleUrl, imageUrl, labelName, allArticles) {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/?$/, '/')

  // Build older articles for CTA section (up to 3, excluding current)
  const olderArticles = (allArticles || [])
    .filter(a => a.slug !== article.slug)
    .slice(0, 3)
    .map(a => ({
      title: a.title,
      dateFormatted: new Date(a.date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
      url: siteUrl ? `${siteUrl}news/${a.slug}/` : '',
      imageUrl: a.imagePath && siteUrl ? `${siteUrl}news/${a.slug}/${path.basename(a.imagePath)}` : (a.image && siteUrl ? `${siteUrl}news/${a.slug}/${path.basename(a.image)}` : '')
    }))

  const logoUrl = siteUrl ? `${siteUrl}logo-round.png` : ''

  return nunjucks.render('newsletter.njk', {
    subject: article.title,
    labelName,
    siteUrl,
    logoUrl,
    articleUrl,
    article: {
      title: article.title,
      dateFormatted: new Date(article.date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
      heroImageUrl: imageUrl,
      html: article.html || `<p>${article.excerpt}</p>`
    },
    olderArticles,
    social: {
      bandcamp: process.env.BANDCAMP_LABEL_URL || process.env.LABEL_BANDCAMP_URL || '',
      spotify: process.env.LABEL_SPOTIFY_URL || '',
      youtube: process.env.LABEL_YOUTUBE_URL || '',
      soundcloud: process.env.LABEL_SOUNDCLOUD_URL || '',
      instagram: process.env.LABEL_INSTAGRAM_URL || ''
    },
    labelAddress: process.env.LABEL_ADDRESS || '',
    currentYear: new Date().getFullYear()
  })
}

/**
 * Creates a draft campaign in Sendy.
 */
async function createSendyCampaign (article, htmlBody, plainText) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiKey = process.env.NEWSLETTER_API_KEY
  const listId = process.env.NEWSLETTER_LIST_ID
  const fromName = process.env.NEWSLETTER_FROM_NAME || process.env.LABEL_NAME || 'Newsletter'
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL || process.env.LABEL_EMAIL || ''
  const replyTo = process.env.NEWSLETTER_REPLY_TO || fromEmail
  const brandId = process.env.NEWSLETTER_BRAND_ID || '1'

  if (!actionUrl || !apiKey || !listId || !fromEmail) {
    throw new Error('Missing required env vars for Sendy campaign (NEWSLETTER_ACTION_URL, NEWSLETTER_API_KEY, NEWSLETTER_LIST_ID, NEWSLETTER_FROM_EMAIL or LABEL_EMAIL)')
  }

  const data = querystring.stringify({
    api_key: apiKey,
    from_name: fromName,
    from_email: fromEmail,
    reply_to: replyTo,
    title: `News: ${article.title}`,
    subject: article.title,
    plain_text: plainText,
    html_text: htmlBody,
    list_ids: listId,
    brand_id: brandId,
    send_campaign: '0' // draft only
  })

  return postRequest(actionUrl + '/api/campaigns/create.php', data, 'form')
}

/**
 * Creates a draft campaign in Listmonk.
 */
async function createListmonkCampaign (article, htmlBody) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiUser = process.env.NEWSLETTER_API_USER || ''
  const apiToken = process.env.NEWSLETTER_API_TOKEN || ''
  const listId = parseInt(process.env.NEWSLETTER_LIST_ID, 10)
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL || process.env.LABEL_EMAIL || ''

  if (!actionUrl || !apiUser || !apiToken || !listId) {
    throw new Error('Missing required env vars for Listmonk campaign (NEWSLETTER_ACTION_URL, NEWSLETTER_API_USER, NEWSLETTER_API_TOKEN, NEWSLETTER_LIST_ID)')
  }

  const body = JSON.stringify({
    name: `News: ${article.title}`,
    subject: article.title,
    lists: [listId],
    from_email: fromEmail ? `${process.env.LABEL_NAME || 'Newsletter'} <${fromEmail}>` : undefined,
    content_type: 'html',
    type: 'regular',
    body: htmlBody,
    tags: ['auto-news']
  })

  return postRequest(actionUrl + '/api/campaigns', body, 'json', apiUser, apiToken)
}

/**
 * Generic HTTP POST helper.
 */
function postRequest (url, data, format, username, password) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const protocol = parsed.protocol === 'https:' ? https : http
    const headers = format === 'json'
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }

    if (username && password) {
      headers.Authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
    }

    const req = protocol.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers
    }, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body)
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

module.exports = { createCampaignDrafts, buildCampaignHtml }
