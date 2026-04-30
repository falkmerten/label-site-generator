'use strict'

/**
 * Service-specific configuration (not user-configurable).
 */
const SERVICE_CONFIG = {
  spotify: { minDelay: 200, maxRetries: 4, baseBackoff: 1000 },
  soundcharts: { minDelay: 1000, maxRetries: 4, baseBackoff: 1000 },
  discogs: { minDelay: 1000, maxRetries: 3, baseBackoff: 2000 },
  bandcamp: { minDelay: 1500, maxRetries: 2, baseBackoff: 3000 }
}

/**
 * Tracks last call time per service (module-level).
 * @type {Map<string, number>}
 */
const lastCallTimes = new Map()

/**
 * Sleeps for the specified number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Wraps an async API call with rate limiting and retry logic.
 *
 * @param {string} service - Service name (spotify, soundcharts, discogs, bandcamp)
 * @param {function(): Promise<T>} fn - The API call to execute
 * @param {string} [context] - Description for logging (e.g. album title)
 * @returns {Promise<T|null>} Result or null if all retries exhausted
 */
async function withRateLimit (service, fn, context) {
  const config = SERVICE_CONFIG[service]
  if (!config) {
    throw new Error(`[rate-limit] Unknown service: ${service}`)
  }

  const { minDelay, maxRetries, baseBackoff } = config

  // Enforce minimum delay since last call to this service
  const now = Date.now()
  const lastCall = lastCallTimes.get(service) || 0
  const elapsed = now - lastCall
  if (elapsed < minDelay) {
    await sleep(minDelay - elapsed)
  }

  let retryCount = 0

  while (retryCount <= maxRetries) {
    // Update last call time just before executing
    lastCallTimes.set(service, Date.now())

    try {
      const result = await fn()
      return result
    } catch (err) {
      // Check if this is a 429 rate limit error
      const statusCode = err.statusCode || err.status
      if (statusCode === 429) {
        if (retryCount >= maxRetries) {
          // All retries exhausted
          const label = context ? `"${context}"` : service
          console.warn(`[rate-limit] All retries exhausted for ${label}, skipping`)
          return null
        }

        // Exponential backoff: baseBackoff * 2^retryCount
        const delay = baseBackoff * Math.pow(2, retryCount)
        console.warn(`[rate-limit] Rate limit hit for ${service}, waiting ${delay / 1000}s...`)
        await sleep(delay)
        retryCount++
      } else {
        // Non-429 error — throw immediately
        throw err
      }
    }
  }

  // Should not reach here, but safety net
  return null
}

/**
 * Creates a rate limiter instance for a specific service.
 * Tracks last call time and enforces minimum delay.
 *
 * @param {string} service - Service name
 * @returns {{ wait: function, reset: function }}
 */
function createRateLimiter (service) {
  const config = SERVICE_CONFIG[service]
  if (!config) {
    throw new Error(`[rate-limit] Unknown service: ${service}`)
  }

  let lastTime = 0

  return {
    /**
     * Wait for the minimum delay before next call.
     * @returns {Promise<void>}
     */
    async wait () {
      const now = Date.now()
      const elapsed = now - lastTime
      if (elapsed < config.minDelay) {
        await sleep(config.minDelay - elapsed)
      }
      lastTime = Date.now()
    },

    /**
     * Reset the rate limiter state.
     */
    reset () {
      lastTime = 0
    }
  }
}

module.exports = { withRateLimit, createRateLimiter, SERVICE_CONFIG }
