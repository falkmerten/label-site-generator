'use strict'

/**
 * Release-type classification (ported from v6, LSGPRO-56).
 * Used to pick the slug suffix when two releases share a title.
 *
 *   Single    1–3 tracks  AND  < 30 min
 *   EP        4–6 tracks  AND  < 30 min
 *   Album/LP  7+ tracks   OR   > 30 min   (duration wins)
 *
 * Bandcamp /track/ URLs are always singles. Unknown track count → 'album'.
 */

const THIRTY_MINUTES_SEC = 30 * 60

/**
 * Parse a track's duration into seconds. Supports numbers (seconds) and
 * "M:SS" / "H:MM:SS" strings. Returns 0 when unknown.
 */
function trackSeconds (track) {
  if (!track) return 0
  if (typeof track.duration === 'number' && track.duration > 0) return track.duration
  if (typeof track.duration === 'string') {
    const parts = track.duration.split(':').map(p => parseInt(p, 10))
    if (parts.some(n => isNaN(n))) return 0
    return parts.reduce((acc, n) => acc * 60 + n, 0)
  }
  return 0
}

/**
 * Total runtime in seconds. Prefers raw.trackinfo (numeric seconds), falls back
 * to tracks[].duration strings. Returns 0 if unknown.
 */
function totalDurationSeconds (album) {
  const rawTi = album && album.raw && album.raw.trackinfo
  if (Array.isArray(rawTi) && rawTi.length > 0) {
    const sum = rawTi.reduce((acc, t) => acc + (typeof t.duration === 'number' ? t.duration : 0), 0)
    if (sum > 0) return sum
  }
  const tracks = album && album.tracks
  if (Array.isArray(tracks) && tracks.length > 0) {
    return tracks.reduce((acc, t) => acc + trackSeconds(t), 0)
  }
  return 0
}

/**
 * Classify a release as 'single' | 'ep' | 'album'.
 * @param {object} album
 * @returns {'single'|'ep'|'album'}
 */
function classifyReleaseType (album) {
  if (album && typeof album.url === 'string' && /\/track\//.test(album.url)) return 'single'

  const rawTi = album && album.raw && album.raw.trackinfo
  const trackCount = (album && album.tracks && album.tracks.length) ||
    (Array.isArray(rawTi) ? rawTi.length : 0)
  const durationSec = totalDurationSeconds(album)

  if (trackCount >= 7) return 'album'
  if (durationSec > THIRTY_MINUTES_SEC) return 'album'
  if (trackCount >= 1 && trackCount <= 3) return 'single'
  if (trackCount >= 4 && trackCount <= 6) return 'ep'
  return 'album'
}

module.exports = { classifyReleaseType, totalDurationSeconds }
