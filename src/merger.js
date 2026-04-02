'use strict'

const fs = require('fs/promises')
const path = require('path')
const { toSlug } = require('./slugs')
const { renderMarkdown } = require('./markdown')

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
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
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

  const mergedArtists = await Promise.all(
    (rawData.artists || []).map(async (artist) => {
      const artistSlug = toSlug(artist.name)
      const artistContent = (content.artists || {})[artistSlug]

      if (!artistContent) {
        if (hasContentArtists) {
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
              artwork: album.imageUrl || (album.artwork ? path.basename(album.artwork) : null),
              tracks: album.tracks,
              tags: album.tags,
              albumId,
              itemType: (album.raw && album.raw.item_type) || album.itemType || 'album',
              releaseDate: rawReleaseDate ? new Date(rawReleaseDate).toISOString() : (album.releaseDate || null),
              description: (current && current.about) ? current.about : (album.description || null),
              credits: (current && current.credits) ? current.credits : null,
              streamingLinks: album.streamingLinks || null,
              upc: album.upc || null,
              physicalFormats: album.physicalFormats || (bandcampPhysicalFormats.length ? bandcampPhysicalFormats : null),
              bandcampPhysicalFormats: bandcampPhysicalFormats.length ? bandcampPhysicalFormats : null,
              discogsUrl: album.discogsUrl || null,
              discogsSellUrl: album.discogsSellUrl || null,
              discogsSellUrlVinyl: album.discogsSellUrlVinyl || null,
              discogsSellUrlCd: album.discogsSellUrlCd || null,
              discogsSellUrlCassette: album.discogsSellUrlCassette || null,
              labelName: album.labelName || null,
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
          slug: artistSlug,
          albums
        }
      }

      // Apply content overrides
      let biography
      if (artistContent.bioPath) {
        const mdContent = await fs.readFile(artistContent.bioPath, 'utf8')
        biography = renderMarkdown(mdContent)
      } else {
        biography = stripMoreSuffix(artist.description)
      }

      const photo = artistContent.photoPath ? path.basename(artistContent.photoPath) : artist.coverImage

      const albums = await Promise.all(
        (artist.albums || [])
          .filter(album => albumBelongsToArtist(album, artist.name))
          .map(async (album) => {
          const albumSlug = toSlug(album.title)
          const albumContent = (artistContent.albums || {})[albumSlug]
          const albumId = extractAlbumId(album.raw)

          let artwork
          let notes

          if (albumContent && albumContent.artworkPath) {
            artwork = path.basename(albumContent.artworkPath)
          } else {
            // Use imageUrl (remote) or local artwork path — store basename for template
            artwork = album.imageUrl || (album.artwork ? path.basename(album.artwork) : null)
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
            tracks: album.tracks,
            tags: album.tags,
            albumId,
            itemType: (album.raw && album.raw.item_type) || album.itemType || 'album',
            releaseDate: rawReleaseDate2 ? new Date(rawReleaseDate2).toISOString() : (album.releaseDate || null),
            description: (rawCurrent && rawCurrent.about) ? rawCurrent.about : (album.description || null),
            credits: (rawCurrent && rawCurrent.credits) ? rawCurrent.credits : null,
            streamingLinks: album.streamingLinks || null,
            upc: album.upc || null,
            physicalFormats: album.physicalFormats || (bandcampPhysicalFormats2.length ? bandcampPhysicalFormats2 : null),
            bandcampPhysicalFormats: bandcampPhysicalFormats2.length ? bandcampPhysicalFormats2 : null,
            discogsUrl: album.discogsUrl || null,
            discogsSellUrl: album.discogsSellUrl || null,
            discogsSellUrlVinyl: album.discogsSellUrlVinyl || null,
            discogsSellUrlCd: album.discogsSellUrlCd || null,
            discogsSellUrlCassette: album.discogsSellUrlCassette || null,
            labelName: album.labelName || null,
            slug: albumSlug
          }

          if (notes !== undefined) {
            mergedAlbum.notes = notes
          }

          if (albumContent && albumContent.videos) {
            mergedAlbum.videos = albumContent.videos
          }

          if (albumContent && albumContent.customStores) {
            mergedAlbum.customStores = albumContent.customStores
          }

          return mergedAlbum
        })
      )

      const mergedArtist = {
        url: artist.url,
        name: artist.name,
        location: artist.location,
        biography,
        photo,
        galleryImages: (artistContent.galleryImages || []).map(p => path.basename(p)),
        bandLinks: artist.bandLinks,
        streamingLinks: artist.streamingLinks || null,
        slug: artistSlug,
        albums
      }

      if (artistContent.meta) {
        Object.assign(mergedArtist, artistContent.meta)
      }

      return mergedArtist
    })
  )

  return {
    scrapedAt: rawData.scrapedAt,
    artists: mergedArtists
  }
}

module.exports = { mergeData, extractAlbumId }
