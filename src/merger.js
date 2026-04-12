'use strict'

const fs = require('fs/promises')
const path = require('path')
const { toSlug } = require('./slugs')
const { renderMarkdown } = require('./markdown')

/**
 * Returns the first non-null, non-undefined value from the arguments.
 * Used to enforce the content > cache > scraped priority hierarchy.
 * @param {...*} values
 * @returns {*}
 */
function pickFirst (...values) {
  for (const v of values) {
    if (v !== null && v !== undefined) return v
  }
  return null
}

/**
 * Deduplicates events by date (same day) + city.
 * Keeps the entry with the longer venue name (more specific).
 */
function deduplicateEvents (events) {
  if (!events || events.length === 0) return events
  const seen = new Map()
  for (const e of events) {
    const day = (e.date || '').slice(0, 10)
    const city = (e.cityName || '').toLowerCase().trim()
    const key = `${day}|${city}`
    const existing = seen.get(key)
    if (!existing || (e.venueName || '').length > (existing.venueName || '').length) {
      seen.set(key, e)
    }
  }
  return [...seen.values()]
}

/**
 * Strips Bandcamp's "... more" truncation suffix from bio text.
 */
function stripMoreSuffix (text) {
  if (!text) return text
  return text.replace(/\s*\.\.\.\s*more\s*$/i, '').trim()
}

/**
 * Extracts the album ID from a raw bandcamp-scraper album object.
 * Prefers raw.id, falls back to raw.album_id, returns null if neither present.
 *
 * @param {object} raw
 * @returns {string|null}
 */
function extractAlbumId (raw) {
  if (!raw) return null
  if (raw.id != null) return String(raw.id)
  if (raw.album_id != null) return String(raw.album_id)
  return null
}

/**
 * Returns true if the album's artist field matches the given artist name.
 * Handles cases like "various" compilations — those are kept.
 * Filters out albums clearly belonging to a different artist (e.g. a guest artist's
 * releases appearing on the label's main artist page).
 */
function albumBelongsToArtist (album, artistName) {
  if (!album.artist) return true // no artist field — keep it
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const albumArtist = norm(album.artist)
  const owner = norm(artistName)
  if (albumArtist === 'various') return true // compilations always kept
  return albumArtist === owner
}

/**
 * Merges scraped RawSiteData with ContentStore overrides.
 *
 * @param {object} rawData - RawSiteData
 * @param {object} content - ContentStore
 * @returns {Promise<object>} MergedSiteData
 */
async function mergeData (rawData, content) {
  const hasContentArtists = Object.keys(content.artists || {}).length > 0

  // Load youtube.json for channel URL merging
  let youtubeConfig = {}
  if (content._contentDir) {
    try {
      const ytRaw = await fs.readFile(path.join(content._contentDir, 'youtube.json'), 'utf8')
      const ytData = JSON.parse(ytRaw)
      youtubeConfig = ytData.artists || ytData // support both new and old format
    } catch { /* no youtube.json */ }
  }

  const mergedArtists = await Promise.all(
    (rawData.artists || []).map(async (artist) => {
      const artistSlug = toSlug(artist.name)
      const artistContent = (content.artists || {})[artistSlug]

      if (!artistContent) {
        if (hasContentArtists && artist.name.toLowerCase() !== 'various artists') {
          console.warn(`[merger] No content override found for artist "${artist.name}" (slug: "${artistSlug}")`)
        }

        const albums = await Promise.all(
          (artist.albums || [])
            .filter(album => albumBelongsToArtist(album, artist.name))
            .map(async (album) => {
            const albumId = extractAlbumId(album.raw)
            const current = album.raw && album.raw.current
            const rawReleaseDate = (current && current.release_date) ||
              (album.raw && album.raw.album_release_date) ||
              (current && current.new_date)
            // Extract physical package types from raw Bandcamp data
            const packages = (album.raw && album.raw.packages) || []
            const bandcampPhysicalFormats = [...new Set(packages.map(p => {
              const t = (p.type_name || '').toLowerCase()
              if (t.includes('vinyl') || t.includes('lp')) return 'Vinyl'
              if (t.includes('cd') || t.includes('compact disc')) return 'CD'
              if (t.includes('cass') || t.includes('tape')) return 'Cassette'
              if (t.includes('box')) return 'Box Set'
              return null
            }).filter(Boolean))]
            return {
              url: album.url,
              title: album.title,
              artist: album.artist,
              artwork: album.imageUrl || (album.artwork
                ? (album.artwork.startsWith('http') ? album.artwork : path.basename(album.artwork))
                : null),
              tracks: (album.tracks || []).filter(t => (t.name || ``).trim().toLowerCase() !== `video`),
              tags: album.tags,
              albumId,
              itemType: (album.raw && album.raw.item_type) || album.itemType || 'album',
              releaseDate: rawReleaseDate ? new Date(rawReleaseDate).toISOString() : (album.releaseDate || null),
              description: (current && current.about) ? current.about : (album.description || null),
              credits: (current && current.credits) ? current.credits : null,
              streamingLinks: album.streamingLinks || null,
              upc: album.upc || null,
              catalogNumber: album.catalogNumber || null,
              physicalFormats: album.physicalFormats || (bandcampPhysicalFormats.length ? bandcampPhysicalFormats : null),
              bandcampPhysicalFormats: bandcampPhysicalFormats.length ? bandcampPhysicalFormats : null,
              discogsUrl: album.discogsUrl || null,
              discogsSellUrl: album.discogsSellUrl || null,
              discogsSellUrlVinyl: album.discogsSellUrlVinyl || null,
              discogsSellUrlCd: album.discogsSellUrlCd || null,
              discogsSellUrlCassette: album.discogsSellUrlCassette || null,
              labelName: album.labelName || null,
              labelUrl: album.labelUrl || null,
              discogsLabel: album.discogsLabel || null,
              discogsLabelUrls: album.discogsLabelUrls || null,
              upcoming: album.upcoming || false,
              presaveUrl: album.presaveUrl || null,
              labelUrls: album.labelUrls || (album.labelUrl
                ? [album.labelUrl, ...Array(
                    Math.max(0, (album.labelName || '').split(' / ').length - 1)
                  ).fill(null)]
                : null),
              slug: toSlug(album.title)
            }
          })
        )

        return {
          url: artist.url,
          name: artist.name,
          location: artist.location,
          biography: stripMoreSuffix(artist.description),
          photo: artist.coverImage,
          galleryImages: [],
          bandLinks: artist.bandLinks,
          streamingLinks: artist.streamingLinks || null,
          socialLinks: artist.socialLinks || null,
          discoveryLinks: artist.discoveryLinks || null,
          eventLinks: artist.eventLinks || null,
          events: deduplicateEvents(artist.events || []),
          slug: artistSlug,
          albums
        }
      }

      // Apply content overrides with content > cache > scraped priority
      let biography
      if (artistContent.bioPath) {
        const mdContent = await fs.readFile(artistContent.bioPath, 'utf8')
        biography = renderMarkdown(mdContent)
      } else {
        biography = pickFirst(artist.biography, stripMoreSuffix(artist.description))
      }

      const location = pickFirst(artist.location)
      const photo = artistContent.photoPath ? path.basename(artistContent.photoPath) : artist.coverImage

      const albums = await Promise.all(
        (artist.albums || [])
          .filter(album => albumBelongsToArtist(album, artist.name))
          .map(async (album) => {
          const albumSlug = toSlug(album.title)
          // Try multiple slug forms to find content folder:
          // 1. Cache slug (may be deduped like center-of-your-world-2)
          // 2. Title-derived slug
          // 3. URL-derived slug (from Bandcamp URL, e.g. principe-valiente-ep)
          // 4. Year-deduped slug (e.g. principe-valiente-2007)
          const albumContentCandidates = [album.slug, albumSlug]
          if (album.url) {
            const urlMatch = album.url.match(/\/(album|track)\/([^/?#]+)/)
            if (urlMatch) albumContentCandidates.push(urlMatch[2])
          }
          if (album.releaseDate) {
            const year = new Date(album.releaseDate).getFullYear()
            if (year) albumContentCandidates.push(`${albumSlug}-${year}`)
          }
          let albumContent = null
          for (const candidate of albumContentCandidates) {
            if (candidate && (artistContent.albums || {})[candidate]) {
              albumContent = (artistContent.albums || {})[candidate]
              break
            }
          }
          const albumId = extractAlbumId(album.raw)

          let artwork
          let notes

          if (albumContent && albumContent.artworkPath) {
            artwork = path.basename(albumContent.artworkPath)
          } else {
            // Use imageUrl (remote) or local artwork path — store basename for template
            artwork = album.imageUrl || (album.artwork
              ? (album.artwork.startsWith('http') ? album.artwork : path.basename(album.artwork))
              : null)
          }

          if (albumContent && albumContent.notesPath) {
            const mdContent = await fs.readFile(albumContent.notesPath, 'utf8')
            notes = renderMarkdown(mdContent)
          }

          const rawCurrent = album.raw && album.raw.current
          const rawReleaseDate2 = (rawCurrent && rawCurrent.release_date) ||
            (album.raw && album.raw.album_release_date) ||
            (rawCurrent && rawCurrent.new_date)
          const packages2 = (album.raw && album.raw.packages) || []
          const bandcampPhysicalFormats2 = [...new Set(packages2.map(p => {
            const t = (p.type_name || '').toLowerCase()
            if (t.includes('vinyl') || t.includes('lp')) return 'Vinyl'
            if (t.includes('cd') || t.includes('compact disc')) return 'CD'
            if (t.includes('cass') || t.includes('tape')) return 'Cassette'
            if (t.includes('box')) return 'Box Set'
            return null
          }).filter(Boolean))]
          const mergedAlbum = {
            url: album.url,
            title: album.title,
            artist: album.artist,
            artwork,
            tracks: (album.tracks || []).filter(t => (t.name || ``).trim().toLowerCase() !== `video`),
            tags: album.tags,
            albumId,
            itemType: (album.raw && album.raw.item_type) || album.itemType || 'album',
            releaseDate: rawReleaseDate2 ? new Date(rawReleaseDate2).toISOString() : (album.releaseDate || null),
            description: pickFirst(
              notes,
              album.description,
              (rawCurrent && rawCurrent.about) ? rawCurrent.about : null
            ),
            credits: pickFirst(album.credits, (rawCurrent && rawCurrent.credits) ? rawCurrent.credits : null),
            streamingLinks: album.streamingLinks || null,
            upc: album.upc || null,
            catalogNumber: album.catalogNumber || null,
            physicalFormats: album.physicalFormats || (bandcampPhysicalFormats2.length ? bandcampPhysicalFormats2 : null),
            bandcampPhysicalFormats: bandcampPhysicalFormats2.length ? bandcampPhysicalFormats2 : null,
            discogsUrl: album.discogsUrl || null,
            discogsSellUrl: album.discogsSellUrl || null,
            discogsSellUrlVinyl: album.discogsSellUrlVinyl || null,
            discogsSellUrlCd: album.discogsSellUrlCd || null,
            discogsSellUrlCassette: album.discogsSellUrlCassette || null,
            labelName: album.labelName || null,
            labelUrl: album.labelUrl || null,
            discogsLabel: album.discogsLabel || null,
            discogsLabelUrls: album.discogsLabelUrls || null,
            upcoming: album.upcoming || false,
            presaveUrl: album.presaveUrl || null,
            labelUrls: album.labelUrls || (album.labelUrl
              ? [album.labelUrl, ...Array(
                  Math.max(0, (album.labelName || '').split(' / ').length - 1)
                ).fill(null)]
              : null),
            slug: albumSlug
          }

          if (notes !== undefined) {
            mergedAlbum.notes = notes
            // Content notes also serve as the description override (content > cache > scraped)
          }

          if (albumContent && albumContent.videos) {
            mergedAlbum.videos = albumContent.videos
          }

          if (albumContent && albumContent.customStores) {
            mergedAlbum.customStores = albumContent.customStores
          }

          if (albumContent && albumContent.hidePhysical) {
            mergedAlbum.hidePhysical = true
          }

          if (albumContent && albumContent.reviewsPath) {
            try {
              const mdContent = await fs.readFile(albumContent.reviewsPath, 'utf8')
              mergedAlbum.reviews = renderMarkdown(mdContent)
            } catch { /* ignore */ }
          }

          return mergedAlbum
        })
      )

      const mergedArtist = {
        url: artist.url,
        name: artist.name,
        location,
        biography,
        photo,
        galleryImages: (artistContent.galleryImages || []).map(p => path.basename(p)),
        bandLinks: artist.bandLinks,
        streamingLinks: artist.streamingLinks || null,
        socialLinks: artist.socialLinks || null,
        discoveryLinks: artist.discoveryLinks || null,
        eventLinks: artist.eventLinks || null,
        events: deduplicateEvents(artist.events || []),
        slug: artistSlug,
        albums
      }

      if (artistContent.meta) {
        Object.assign(mergedArtist, artistContent.meta)
      }

      // Merge local tour dates from tourdates.json
      if (artistContent.tourDates) {
        const localEvents = convertLocalTourDates(artistContent.tourDates)
        if (localEvents.length > 0) {
          mergedArtist.events = deduplicateEvents([
            ...(mergedArtist.events || []),
            ...localEvents
          ])
        }
      }

      // Apply links.json overrides (highest priority — manual links come first)
      if (artistContent.links) {
        const cl = artistContent.links
        // Streaming links
        if (cl.streaming) {
          mergedArtist.streamingLinks = mergedArtist.streamingLinks || {}
          for (const [key, url] of Object.entries(cl.streaming)) {
            if (url) mergedArtist.streamingLinks[key] = url
          }
        }
        // Social links
        if (cl.social) {
          mergedArtist.socialLinks = mergedArtist.socialLinks || {}
          for (const [key, url] of Object.entries(cl.social)) {
            if (url) mergedArtist.socialLinks[key] = url
          }
        }
        // Website / non-social links (added to bandLinks if not already present)
        if (cl.websites) {
          mergedArtist.bandLinks = mergedArtist.bandLinks || []
          for (const link of cl.websites) {
            if (link.url && !mergedArtist.bandLinks.some(bl => bl.url === link.url)) {
              mergedArtist.bandLinks.unshift(link)
            }
          }
        }
      }

      return mergedArtist
    })
  )

  // ── Post-merge: fill missing label URLs from known mappings ──────────────
  // Build label name → URL map from albums that have per-label URLs
  const labelUrlMap = {}
  for (const artist of mergedArtists) {
    for (const album of artist.albums || []) {
      if (album.labelName && album.labelUrls) {
        const names = album.labelName.split(' / ')
        for (let i = 0; i < names.length; i++) {
          const name = names[i].trim()
          const url = album.labelUrls[i]
          if (name && url && !labelUrlMap[name]) {
            labelUrlMap[name] = url
          }
        }
      }
      // Also collect from discogsLabelUrls
      if (album.discogsLabel && album.discogsLabelUrls) {
        const dNames = album.discogsLabel.split(' / ')
        for (let i = 0; i < dNames.length; i++) {
          const name = dNames[i].trim()
          const url = album.discogsLabelUrls[i]
          if (name && url && !labelUrlMap[name]) {
            labelUrlMap[name] = url
          }
        }
      }
    }
  }

  // Apply known URLs to albums missing them
  for (const artist of mergedArtists) {
    for (const album of artist.albums || []) {
      if (album.labelName && !album.labelUrl) {
        const names = album.labelName.split(' / ')
        const urls = names.map(n => labelUrlMap[n.trim()] || null)
        if (urls.some(u => u)) {
          album.labelUrls = urls
          album.labelUrl = urls[0]
        }
      }
      // Backfill discogsLabelUrls from known label URL map
      if (album.discogsLabel && !album.discogsLabelUrls) {
        const dNames = album.discogsLabel.split(' / ')
        const dUrls = dNames.map(n => labelUrlMap[n.trim()] || null)
        if (dUrls.some(u => u)) {
          album.discogsLabelUrls = dUrls
        }
      }
    }
  }

  // ── Post-merge: fill YouTube channel URLs from youtube.json ────────────────
  for (const artist of mergedArtists) {
    const ytUrl = youtubeConfig[artist.slug]
    if (ytUrl && !(artist.streamingLinks && artist.streamingLinks.youtube)) {
      artist.streamingLinks = artist.streamingLinks || {}
      artist.streamingLinks.youtube = ytUrl
    }
  }

  return {
    scrapedAt: rawData.scrapedAt,
    artists: mergedArtists
  }
}

/**
 * Convert local tourdates.json entries to Soundcharts event format,
 * filtering out past dates.
 * @param {Array} tourDates - Raw entries from tourdates.json
 * @returns {Array} Converted events with future dates only
 */
function convertLocalTourDates (tourDates) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (tourDates || [])
    .filter(entry => {
      const d = new Date(entry.date + 'T00:00:00')
      return !isNaN(d.getTime()) && d >= today
    })
    .map(entry => ({
      date: entry.date,
      name: entry.name || null,
      type: null,
      venueName: entry.venue || null,
      cityName: entry.city || null,
      countryCode: entry.country || null,
      countryName: entry.country || null,
      eventUrl: entry.url || null
    }))
}

/**
 * Merges Bandsintown events into an existing events array using three-tier priority:
 * Soundcharts (no source field) > Bandsintown (source: 'bandsintown') > tourdates.json
 *
 * Deduplicates by date+city. When events conflict, keeps the higher-priority version
 * but preserves Bandsintown-specific fields (eventUrl, offers, source) from the BIT event.
 *
 * @param {Array} existingEvents - Events from Soundcharts + tourdates.json
 * @param {Array} bandsintownEvents - Events from Bandsintown API
 * @returns {Array} Merged, deduplicated, date-sorted events
 */
function mergeBandsintownEvents (existingEvents, bandsintownEvents) {
  const existing = Array.isArray(existingEvents) ? existingEvents : []
  const bit = Array.isArray(bandsintownEvents) ? bandsintownEvents : []

  const merged = new Map()
  const byDate = new Map() // date → [keys in merged]

  // First pass: index existing events
  for (const event of existing) {
    const key = dedupKey(event)
    merged.set(key, event)
    const day = (event.date || '').slice(0, 10)
    if (!byDate.has(day)) byDate.set(day, [])
    byDate.get(day).push(key)
  }

  // Second pass: merge Bandsintown events
  for (const bitEvent of bit) {
    const key = dedupKey(bitEvent)

    // Try exact date+city match first
    let matchKey = merged.has(key) ? key : null

    // Fallback: find an existing event on the same date with overlapping venue name
    if (!matchKey) {
      const day = (bitEvent.date || '').slice(0, 10)
      const bitVenue = (bitEvent.venueName || '').toLowerCase().trim()
      const sameDay = byDate.get(day) || []
      for (const candidateKey of sameDay) {
        const candidate = merged.get(candidateKey)
        if (!candidate) continue
        const existVenue = (candidate.venueName || '').toLowerCase().trim()
        // Match if either venue name contains the other (handles "Kapellet" vs "Artist - Live @ Kapellet")
        if (existVenue && bitVenue && (existVenue.includes(bitVenue) || bitVenue.includes(existVenue))) {
          matchKey = candidateKey
          break
        }
      }
    }

    if (matchKey && merged.has(matchKey)) {
      const existingEvent = merged.get(matchKey)
      if (!existingEvent.source) {
        merged.set(matchKey, {
          ...existingEvent,
          eventUrl: bitEvent.eventUrl || existingEvent.eventUrl || null,
          offers: bitEvent.offers || existingEvent.offers || [],
          source: 'bandsintown'
        })
      }
    } else {
      merged.set(key, bitEvent)
      const day = (bitEvent.date || '').slice(0, 10)
      if (!byDate.has(day)) byDate.set(day, [])
      byDate.get(day).push(key)
    }
  }

  // Sort by date ascending
  return [...merged.values()].sort((a, b) => {
    const dateA = a.date || ''
    const dateB = b.date || ''
    return dateA < dateB ? -1 : dateA > dateB ? 1 : 0
  })
}

/**
 * Creates a deduplication key from an event's date and city (case-insensitive).
 * @param {object} event
 * @returns {string}
 */
function dedupKey (event) {
  const day = (event.date || '').slice(0, 10)
  const city = (event.cityName || '').toLowerCase().trim()
  return `${day}|${city}`
}

module.exports = { mergeData, extractAlbumId, pickFirst, albumBelongsToArtist, convertLocalTourDates, mergeBandsintownEvents }
