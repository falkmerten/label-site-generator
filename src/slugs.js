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
 * @param {Array<{name: string, albums: Array<{title: string}>}>} artists
 * @returns {Array} New array of artist objects with `slug` fields added (originals not mutated)
 */
function assignSlugs (artists) {
  const artistSlugCounts = {}

  return artists.map(artist => {
    const baseSlug = toSlug(artist.name)
    artistSlugCounts[baseSlug] = (artistSlugCounts[baseSlug] || 0) + 1
    const count = artistSlugCounts[baseSlug]
    const artistSlug = count === 1 ? baseSlug : `${baseSlug}-${count}`

    const albumSlugCounts = {}
    const albums = (artist.albums || []).map(album => {
      const albumBase = toSlug(album.title)
      albumSlugCounts[albumBase] = (albumSlugCounts[albumBase] || 0) + 1
      const albumCount = albumSlugCounts[albumBase]
      const albumSlug = albumCount === 1 ? albumBase : `${albumBase}-${albumCount}`
      return { ...album, slug: albumSlug }
    })

    return { ...artist, slug: artistSlug, albums }
  })
}

module.exports = { toSlug, assignSlugs }
