const { classifyReleaseType } = require('./releaseType')

/**
 * Converts a name string to a URL-safe slug.
 * - Lowercases the input
 * - Replaces all non-alphanumeric characters with hyphens
 * - Collapses consecutive hyphens into a single hyphen
 * - Trims leading and trailing hyphens
 * - Returns empty string for empty/null/undefined input
 *
 * @param {string} name
 * @returns {string}
 */
function toSlug (name) {
  if (!name) return ''
  return name
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '') // strip zero-width chars
    .toLowerCase()
    .normalize('NFD')                    // decompose accented chars: á → a + ́
    .replace(/[\u0300-\u036f]/g, '')     // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Numeric Bandcamp release id from cached raw tralbum data (raw.current.id,
 * fallback raw.id). The most stable release identity: it survives title, slug
 * and URL changes. Returns a string or '' when unknown.
 * @param {object} album
 * @returns {string}
 */
function bcIdOf (album) {
  const raw = album && album.raw
  if (!raw) return ''
  if (raw.current && raw.current.id != null) return String(raw.current.id)
  if (raw.id != null) return String(raw.id)
  return ''
}

const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Assigns URL-safe slugs to artists and their albums.
 *
 * Album slugs (ported from v6, LSGPRO-58 — adapted so no existing v5 URL changes):
 * 1. An album that already has a slug (from the cache) keeps it, as long as no
 *    earlier album in the list has claimed it. This keeps live URLs stable when
 *    a title changes (Bandcamp edit, Spotify title normalization, upcoming → live).
 * 2. Albums without a slug get one from their title. When several of them share
 *    a title, the primary release (most tracks, then earliest release date, then
 *    Bandcamp id) gets the plain slug; the others get `-single` / `-ep` by release
 *    type, or `-2`, `-3` as a last resort. The result no longer depends on the
 *    order Bandcamp lists the releases in.
 *
 * @param {Array<{name: string, albums: Array<{title: string, slug?: string, url?: string, tracks?: Array}>}>} artists
 * @returns {Array} New array of artist objects with `slug` fields added (originals not mutated)
 */
function assignSlugs (artists) {
  const artistSlugCounts = {}

  return artists.map(artist => {
    const baseSlug = toSlug(artist.name)
    artistSlugCounts[baseSlug] = (artistSlugCounts[baseSlug] || 0) + 1
    const count = artistSlugCounts[baseSlug]
    const artistSlug = count === 1 ? baseSlug : `${baseSlug}-${count}`

    const albums = (artist.albums || []).map(album => ({ ...album }))
    const usedSlugs = new Set()
    const claim = (slug) => { usedSlugs.add(slug); return slug }

    // Pass 1: keep established slugs (first claim wins, in list order)
    const pending = []
    for (const album of albums) {
      if (album.slug && VALID_SLUG.test(album.slug) && !usedSlugs.has(album.slug)) {
        claim(album.slug)
      } else {
        pending.push(album)
      }
    }

    // Pass 2: new slugs, grouped by title so same-title releases are ordered
    // deterministically (primary release first)
    const groups = new Map()
    for (const album of pending) {
      const base = toSlug(album.title)
      if (!groups.has(base)) groups.set(base, [])
      groups.get(base).push(album)
    }

    const releaseTime = (album) => {
      const t = album.releaseDate ? new Date(album.releaseDate).getTime() : NaN
      return Number.isFinite(t) ? t : Infinity
    }
    const trackCount = (album) => (album.tracks ? album.tracks.length : 0)
    const anchorSort = (a, b) => {
      if (trackCount(b) !== trackCount(a)) return trackCount(b) - trackCount(a) // more tracks first
      if (releaseTime(a) !== releaseTime(b)) return releaseTime(a) - releaseTime(b) // earlier first
      const byId = bcIdOf(a).localeCompare(bcIdOf(b))
      if (byId !== 0) return byId
      return String(a.url || '').localeCompare(String(b.url || ''))
    }
    const nextNumeric = (base) => {
      let suffix = 2
      while (usedSlugs.has(`${base}-${suffix}`)) suffix++
      return `${base}-${suffix}`
    }

    for (const [base, group] of groups) {
      group.sort(anchorSort)
      for (const album of group) {
        if (!usedSlugs.has(base)) {
          album.slug = claim(base)
          continue
        }
        const type = classifyReleaseType(album)
        const typed = type === 'single' || type === 'ep' ? `${base}-${type}` : null
        album.slug = claim(typed && !usedSlugs.has(typed) ? typed : nextNumeric(base))
      }
    }

    return { ...artist, slug: artistSlug, albums }
  })
}

module.exports = { toSlug, assignSlugs, bcIdOf }
