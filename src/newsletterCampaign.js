'use strict'

const https = require('https')
const http = require('http')
const fs = require('fs/promises')
const path = require('path')
const querystring = require('querystring')

/**
 * Creates newsletter campaign drafts for new news articles.
 * Supports Sendy, Listmonk, and Keila providers.
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
  const labelName = process.env.SITE_NAME || process.env.LABEL_NAME || 'Newsletter'
  let created = 0

  for (const article of newArticles) {
    try {
      const articleUrl = siteUrl ? `${siteUrl}news/${article.slug}/` : ''
      const imageUrl = article.image && siteUrl ? `${siteUrl}news/${article.slug}/${path.basename(article.image)}` : ''

      const htmlBody = buildCampaignHtml(article, articleUrl, imageUrl, labelName)
      const plainText = `${article.title}\n\n${article.excerpt}\n\nRead more: ${articleUrl}`

      if (provider === 'sendy') {
        await createSendyCampaign(article, htmlBody, plainText)
      } else if (provider === 'listmonk') {
        await createListmonkCampaign(article, htmlBody)
      } else if (provider === 'keila') {
        await createKeilaCampaign(article, plainText)
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
 * Builds a simple HTML email body for a news article.
 */
function buildCampaignHtml (article, articleUrl, imageUrl, labelName) {
  let html = `<div style="max-width:600px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;">`
  if (imageUrl) {
    html += `<img src="${imageUrl}" alt="${article.title}" style="width:100%;max-width:600px;height:auto;border-radius:4px;margin-bottom:16px;">`
  }
  html += `<h1 style="font-size:24px;margin:0 0 8px;">${article.title}</h1>`
  html += `<p style="color:#6b6b8a;font-size:14px;margin:0 0 16px;">${article.date}</p>`
  html += `<p style="font-size:16px;line-height:1.6;margin:0 0 24px;">${article.excerpt}</p>`
  if (articleUrl) {
    html += `<a href="${articleUrl}" style="display:inline-block;padding:12px 24px;background:#0c0032;color:#fff;text-decoration:none;border-radius:4px;font-weight:700;">Read more</a>`
  }
  html += `<hr style="margin:32px 0;border:none;border-top:1px solid #dcdce8;">`
  html += `<p style="font-size:12px;color:#6b6b8a;">${labelName}</p>`
  html += `</div>`
  return html
}

/**
 * Creates a draft campaign in Sendy.
 */
async function createSendyCampaign (article, htmlBody, plainText) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiKey = process.env.NEWSLETTER_API_TOKEN || process.env.NEWSLETTER_API_KEY
  const listId = process.env.NEWSLETTER_LIST_ID
  const fromName = process.env.NEWSLETTER_FROM_NAME || process.env.SITE_NAME || process.env.LABEL_NAME || 'Newsletter'
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL || process.env.SITE_EMAIL || process.env.LABEL_EMAIL || ''
  const replyTo = process.env.NEWSLETTER_REPLY_TO || fromEmail
  const brandId = process.env.NEWSLETTER_BRAND_ID || '1'

  if (!actionUrl || !apiKey || !listId || !fromEmail) {
    throw new Error('Missing required env vars for Sendy campaign (NEWSLETTER_ACTION_URL, NEWSLETTER_API_TOKEN, NEWSLETTER_LIST_ID, NEWSLETTER_FROM_EMAIL or SITE_EMAIL)')
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
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL || process.env.SITE_EMAIL || process.env.LABEL_EMAIL || ''

  if (!actionUrl || !apiUser || !apiToken || !listId) {
    throw new Error('Missing required env vars for Listmonk campaign (NEWSLETTER_ACTION_URL, NEWSLETTER_API_USER, NEWSLETTER_API_TOKEN, NEWSLETTER_LIST_ID)')
  }

  const body = JSON.stringify({
    name: `News: ${article.title}`,
    subject: article.title,
    lists: [listId],
    from_email: fromEmail ? `${process.env.SITE_NAME || process.env.LABEL_NAME || 'Newsletter'} <${fromEmail}>` : undefined,
    content_type: 'html',
    type: 'regular',
    body: htmlBody,
    tags: ['auto-news']
  })

  return postRequest(actionUrl + '/api/campaigns', body, 'json', apiUser, apiToken)
}

/**
 * Creates a draft campaign in Keila.
 */
async function createKeilaCampaign (article, plainText) {
  const actionUrl = process.env.NEWSLETTER_ACTION_URL
  const apiToken = process.env.NEWSLETTER_API_TOKEN
  const senderId = process.env.NEWSLETTER_KEILA_SENDER_ID

  if (!actionUrl || !apiToken || !senderId) {
    const missing = [
      !actionUrl && 'NEWSLETTER_ACTION_URL',
      !apiToken && 'NEWSLETTER_API_TOKEN',
      !senderId && 'NEWSLETTER_KEILA_SENDER_ID'
    ].filter(Boolean)
    throw new Error(`Missing required env vars for Keila campaign: ${missing.join(', ')}`)
  }

  const body = JSON.stringify({
    data: {
      subject: article.title,
      text_body: plainText,
      settings: { type: 'markdown' },
      sender_id: senderId
    }
  })

  return postRequest(actionUrl + '/api/v1/campaigns', body, 'json', null, null, apiToken)
}

/**
 * Generic HTTP POST helper.
 */
function postRequest (url, data, format, username, password, bearerToken) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const protocol = parsed.protocol === 'https:' ? https : http
    const headers = format === 'json'
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }

    if (bearerToken) {
      headers.Authorization = 'Bearer ' + bearerToken
    } else if (username && password) {
      headers.Authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
    }

    const req = protocol.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
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

module.exports = { createCampaignDrafts, buildCampaignHtml, createKeilaCampaign, postRequest }
