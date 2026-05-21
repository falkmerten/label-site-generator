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
 * Assigns URL-safe slugs to artists and their albums, resolving collisions
 * by appending `-2`, `-3`, etc. to duplicates within the same scope.
 *
 * For Bandcamp URLs, when a collision occurs between an album and a track
 * with the same slug, the track (single) gets a `-single` suffix instead
 * of a numeric one.
 *
 * @param {Array<{name: string, albums: Array<{title: string, url?: string}>}>} artists
 * @returns {Array} New array of artist objects with `slug` fields added (originals not mutated)
 */
function assignSlugs (artists) {
  const artistSlugCounts = {}

  return artists.map(artist => {
    const baseSlug = toSlug(artist.name)
    artistSlugCounts[baseSlug] = (artistSlugCounts[baseSlug] || 0) + 1
    const count = artistSlugCounts[baseSlug]
    const artistSlug = count === 1 ? baseSlug : `${baseSlug}-${count}`

    // Disambiguate album slugs — first occurrence keeps the base slug,
    // subsequent duplicates get -single (for tracks) or -2, -3, etc.
    const usedSlugs = new Set()
    const albums = (artist.albums || []).map(album => {
      const albumBase = toSlug(album.title)
      let candidate = albumBase
      if (usedSlugs.has(candidate)) {
        // Collision — try URL-derived disambiguation first
        if (album.url) {
          const urlMatch = album.url.match(/\/(track)\/([^/?#]+)/)
          if (urlMatch) {
            // It's a single/track — use -single suffix
            const singleCandidate = `${albumBase}-single`
            if (!usedSlugs.has(singleCandidate)) {
              candidate = singleCandidate
            }
          }
        }
        // If still colliding, fall back to numeric suffix
        if (usedSlugs.has(candidate)) {
          let suffix = 2
          candidate = `${albumBase}-${suffix}`
          while (usedSlugs.has(candidate)) {
            suffix++
            candidate = `${albumBase}-${suffix}`
          }
        }
      }
      usedSlugs.add(candidate)
      return { ...album, slug: candidate }
    })

    return { ...artist, slug: artistSlug, albums }
  })
}

module.exports = { toSlug, assignSlugs }
