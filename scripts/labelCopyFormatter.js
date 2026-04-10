'use strict'

/**
 * @typedef {Object} ArtistData
 * @property {string} name
 * @property {string} slug
 * @property {AlbumData[]} albums
 */

/**
 * @typedef {Object} AlbumData
 * @property {string} title
 * @property {string|null} releaseDate  - ISO 8601 string or null
 * @property {string|null} upc
 * @property {Track[]} tracks
 */

/**
 * @typedef {Object} Track
 * @property {number} trackNumber
 * @property {string} title
 * @property {string|null} isrc
 * @property {string|null} iswc
 * @property {string[]} authors
 * @property {string[]} composers
 * @property {string[]} producers
 * @property {string[]} publishers
 */

/**
 * Escapes pipe characters in a table cell value so they don't break GFM table syntax.
 * @param {string} value
 * @returns {string}
 */
function escapeCell (value) {
  return String(value).replace(/\|/g, '\\|')
}

/**
 * Formats a comma-separated list of credits, or empty string if none.
 * @param {string[]} values
 * @returns {string}
 */
function formatCredits (values) {
  if (!values || values.length === 0) return ''
  return values.map(escapeCell).join(', ')
}

/**
 * Renders a GFM pipe table for an album's tracks.
 * @param {Track[]} tracks
 * @returns {string}
 */
function formatTrackTable (tracks) {
  // Check if any track has ISWC or publisher data to decide which columns to show
  const hasIswc = tracks.some(t => t.iswc)
  const hasPublishers = tracks.some(t => t.publishers && t.publishers.length > 0)

  let header = '| # | Title | ISRC |'
  let separator = '|---|-------|------|'

  if (hasIswc) {
    header += ' ISWC |'
    separator += '------|'
  }

  header += ' Authors | Composers | Producers |'
  separator += '---------|-----------|-----------|'

  if (hasPublishers) {
    header += ' Publishers |'
    separator += '------------|'
  }

  const rows = tracks.map(track => {
    const num = track.trackNumber
    const title = escapeCell(track.title || '')
    const isrc = track.isrc ? escapeCell(track.isrc) : ''
    const authors = formatCredits(track.authors)
    const composers = formatCredits(track.composers)
    const producers = formatCredits(track.producers)
    const publishers = formatCredits(track.publishers)

    let row = `| ${num} | ${title} | ${isrc} |`
    if (hasIswc) row += ` ${track.iswc ? escapeCell(track.iswc) : ''} |`
    row += ` ${authors} | ${composers} | ${producers} |`
    if (hasPublishers) row += ` ${publishers} |`
    return row
  })
  return [header, separator, ...rows].join('\n')
}

/**
 * Formats a complete label copy markdown document for one artist.
 * @param {ArtistData} artistData
 * @returns {string} GFM markdown
 */
function formatLabelCopy (artistData) {
  const lines = []

  lines.push(`# ${artistData.name}`)
  lines.push('')

  if (!artistData.albums || artistData.albums.length === 0) {
    lines.push('> No album data available.')
    lines.push('')
    return lines.join('\n')
  }

  artistData.albums.forEach((album, index) => {
    lines.push(`## ${album.title}`)
    lines.push('')
    lines.push(`Release Date: ${album.releaseDate || ''}`)
    lines.push(`UPC: ${album.upc || ''}`)
    if (album.label) lines.push(`Label: ${album.label}`)
    if (album.distributor) lines.push(`Distributor: ${album.distributor}`)
    if (album.copyright) lines.push(`Copyright: ${album.copyright}`)
    lines.push('')
    lines.push(formatTrackTable(album.tracks || []))
    lines.push('')
    lines.push('---')
    lines.push('')
  })

  return lines.join('\n')
}

module.exports = { formatLabelCopy }
