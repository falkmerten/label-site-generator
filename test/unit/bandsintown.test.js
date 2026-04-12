'use strict'

const { transformEvent } = require('../../src/bandsintown')

// ---------------------------------------------------------------------------
// Mock https module for API tests
// ---------------------------------------------------------------------------
const https = require('https')
jest.mock('https')

const { fetchArtistInfo, fetchArtistEvents } = require('../../src/bandsintown')

/** Helper: create a mock response (readable stream) */
function mockResponse (statusCode, body) {
  const { EventEmitter } = require('events')
  const res = new EventEmitter()
  res.statusCode = statusCode
  return { res, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

/** Sets up https.get to resolve with the given status + body */
function setupHttps (statusCode, body) {
  https.get.mockImplementation((_opts, cb) => {
    const { res, body: raw } = mockResponse(statusCode, body)
    const { EventEmitter } = require('events')
    const req = new EventEmitter()
    req.setTimeout = jest.fn()
    req.destroy = jest.fn()

    process.nextTick(() => {
      cb(res)
      process.nextTick(() => {
        res.emit('data', raw)
        res.emit('end')
      })
    })

    return req
  })
}

/** Sets up https.get to emit a network error */
function setupHttpsError (errorMessage) {
  https.get.mockImplementation((_opts, _cb) => {
    const { EventEmitter } = require('events')
    const req = new EventEmitter()
    req.setTimeout = jest.fn()
    req.destroy = jest.fn()

    process.nextTick(() => {
      req.emit('error', new Error(errorMessage))
    })

    return req
  })
}

/** Sets up https.get to emit a timeout */
function setupHttpsTimeout () {
  https.get.mockImplementation((_opts, _cb) => {
    const { EventEmitter } = require('events')
    const req = new EventEmitter()
    req.setTimeout = jest.fn()
    req.destroy = jest.fn()

    process.nextTick(() => {
      req.emit('timeout')
    })

    return req
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  console.warn.mockRestore()
  console.log.mockRestore()
})

// ---------------------------------------------------------------------------
// transformEvent
// ---------------------------------------------------------------------------
describe('transformEvent', () => {
  test('transforms a standard event with venue and offers', () => {
    const raw = {
      datetime: '2026-06-15T20:00:00',
      venue: { name: 'Kapellet', city: 'Stockholm', country: 'SE', region: 'Sweden' },
      offers: [{ type: 'Tickets', url: 'https://tickets.example.com', status: 'available' }],
      url: 'https://www.bandsintown.com/e/12345'
    }

    const result = transformEvent(raw)

    expect(result).toEqual({
      date: '2026-06-15',
      name: null,
      type: null,
      venueName: 'Kapellet',
      cityName: 'Stockholm',
      countryCode: 'SE',
      countryName: 'Sweden',
      eventUrl: 'https://www.bandsintown.com/e/12345',
      offers: [{ type: 'Tickets', url: 'https://tickets.example.com', status: 'available' }],
      source: 'bandsintown'
    })
  })

  test('sets source to "bandsintown" always', () => {
    const result = transformEvent({ datetime: '2026-01-01T00:00:00', venue: {} })
    expect(result.source).toBe('bandsintown')
  })

  test('handles festival events (festival_datetime present)', () => {
    const raw = {
      datetime: '2026-08-10T14:00:00',
      festival_datetime: '2026-08-10T12:00:00',
      title: 'Wave-Gotik-Treffen',
      venue: { name: 'Agra', city: 'Leipzig', country: 'DE', region: 'Germany' },
      offers: [],
      url: 'https://www.bandsintown.com/e/99999'
    }

    const result = transformEvent(raw)
    expect(result.name).toBe('Wave-Gotik-Treffen')
    expect(result.type).toBe('festival')
  })

  test('handles missing venue gracefully', () => {
    const raw = { datetime: '2026-03-01T19:00:00', url: 'https://bit.ly/test' }
    const result = transformEvent(raw)
    expect(result.venueName).toBeNull()
    expect(result.cityName).toBeNull()
    expect(result.countryCode).toBeNull()
  })

  test('handles missing offers gracefully', () => {
    const raw = { datetime: '2026-03-01T19:00:00', venue: { name: 'Club' } }
    const result = transformEvent(raw)
    expect(result.offers).toEqual([])
  })

  test('uses starts_at as fallback for datetime', () => {
    const raw = { starts_at: '2026-05-20T21:00:00', venue: { city: 'Berlin' } }
    const result = transformEvent(raw)
    expect(result.date).toBe('2026-05-20')
  })

  test('handles completely empty raw object', () => {
    const result = transformEvent({})
    expect(result.date).toBeNull()
    expect(result.source).toBe('bandsintown')
  })
})

// ---------------------------------------------------------------------------
// fetchArtistInfo
// ---------------------------------------------------------------------------
describe('fetchArtistInfo', () => {
  test('constructs correct API path with URL-encoded artist name', async () => {
    setupHttps(200, { tracker_count: 42, upcoming_event_count: 3 })

    await fetchArtistInfo("Fernando's Eyes", 'test-app-id')

    const callOpts = https.get.mock.calls[0][0]
    expect(callOpts.hostname).toBe('rest.bandsintown.com')
    expect(callOpts.path).toBe("/artists/Fernando's%20Eyes?app_id=test-app-id")
  })

  test('returns trackerCount and upcomingEventCount on success', async () => {
    setupHttps(200, { tracker_count: 100, upcoming_event_count: 5 })

    const result = await fetchArtistInfo('TestArtist', 'app123')
    expect(result).toEqual({ trackerCount: 100, upcomingEventCount: 5 })
  })

  test('returns null on HTTP error', async () => {
    setupHttps(404, { error: 'not found' })

    const result = await fetchArtistInfo('Unknown', 'app123')
    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'))
  })

  test('returns null on network error', async () => {
    setupHttpsError('ECONNREFUSED')

    const result = await fetchArtistInfo('TestArtist', 'app123')
    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Network error'))
  })

  test('returns null on timeout', async () => {
    setupHttpsTimeout()

    const result = await fetchArtistInfo('TestArtist', 'app123')
    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
  })

  test('defaults tracker_count to 0 when not a number', async () => {
    setupHttps(200, { tracker_count: 'many', upcoming_event_count: 2 })

    const result = await fetchArtistInfo('TestArtist', 'app123')
    expect(result.trackerCount).toBe(0)
    expect(result.upcomingEventCount).toBe(2)
  })

  test('returns null when body is not an object', async () => {
    setupHttps(200, 'just a string')

    const result = await fetchArtistInfo('TestArtist', 'app123')
    expect(result).toBeNull()
  })

  test('sets 10s timeout on request', async () => {
    setupHttps(200, { tracker_count: 0, upcoming_event_count: 0 })

    await fetchArtistInfo('TestArtist', 'app123')

    // The mock req.setTimeout should have been called with 10000
    const mockReq = https.get.mock.results[0].value
    expect(mockReq.setTimeout).toHaveBeenCalledWith(10000)
  })
})

// ---------------------------------------------------------------------------
// fetchArtistEvents
// ---------------------------------------------------------------------------
describe('fetchArtistEvents', () => {
  test('constructs correct API path for events endpoint', async () => {
    setupHttps(200, [])

    await fetchArtistEvents("Fernando's Eyes", 'test-app-id')

    const callOpts = https.get.mock.calls[0][0]
    expect(callOpts.path).toBe("/artists/Fernando's%20Eyes/events?app_id=test-app-id")
  })

  test('returns transformed events on success', async () => {
    const apiEvents = [
      {
        datetime: '2026-07-01T20:00:00',
        venue: { name: 'Venue A', city: 'Berlin', country: 'DE', region: 'Germany' },
        offers: [{ type: 'Tickets', url: 'https://tix.com', status: 'available' }],
        url: 'https://www.bandsintown.com/e/111'
      }
    ]
    setupHttps(200, apiEvents)

    const result = await fetchArtistEvents('TestArtist', 'app123')
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe('2026-07-01')
    expect(result[0].source).toBe('bandsintown')
    expect(result[0].venueName).toBe('Venue A')
  })

  test('returns empty array on HTTP error', async () => {
    setupHttps(500, { error: 'server error' })

    const result = await fetchArtistEvents('TestArtist', 'app123')
    expect(result).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'))
  })

  test('returns empty array when API returns empty array', async () => {
    setupHttps(200, [])

    const result = await fetchArtistEvents('TestArtist', 'app123')
    expect(result).toEqual([])
  })

  test('returns empty array on network error', async () => {
    setupHttpsError('ENOTFOUND')

    const result = await fetchArtistEvents('TestArtist', 'app123')
    expect(result).toEqual([])
  })

  test('returns empty array on timeout', async () => {
    setupHttpsTimeout()

    const result = await fetchArtistEvents('TestArtist', 'app123')
    expect(result).toEqual([])
  })

  test('returns empty array when body is not an array', async () => {
    setupHttps(200, { message: 'not an array' })

    const result = await fetchArtistEvents('TestArtist', 'app123')
    expect(result).toEqual([])
  })

  test('URL-encodes special characters in artist name', async () => {
    setupHttps(200, [])

    await fetchArtistEvents('Mötley Crüe', 'app123')

    const callOpts = https.get.mock.calls[0][0]
    expect(callOpts.path).toContain('M%C3%B6tley%20Cr%C3%BCe')
  })
})
