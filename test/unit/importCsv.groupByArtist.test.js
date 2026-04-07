const { groupByArtist } = require('../../src/importCsv')

describe('groupByArtist', () => {
  test('creates one artist per unique release_artist, preserving name casing', () => {
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'Album A', album_track_title: '', catalog_number: 'CAT-01', upc: '123', isrc: '', release_date: '2023-01-01' },
      { type: 'album', id: '2', release_artist: 'Amautica', release_title: 'Album B', album_track_title: '', catalog_number: '', upc: '456', isrc: '', release_date: '2023-06-15' }
    ]
    const result = groupByArtist(rows)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Art Noir')
    expect(result[0].slug).toBe('art-noir')
    expect(result[1].name).toBe('Amautica')
    expect(result[1].slug).toBe('amautica')
  })

  test('groups album rows into CsvAlbum entries per unique artist + title', () => {
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'Silent Green', album_track_title: '', catalog_number: 'AEN-01', upc: '111', isrc: '', release_date: '2023-01-01' }
    ]
    const result = groupByArtist(rows)
    expect(result[0].albums).toHaveLength(1)
    expect(result[0].albums[0].title).toBe('Silent Green')
    expect(result[0].albums[0].slug).toBe('silent-green')
  })

  test('attaches album_track rows to their parent album', () => {
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'Silent Green', album_track_title: '', catalog_number: 'AEN-01', upc: '111', isrc: '', release_date: '2023-01-01' },
      { type: 'album_track', id: '10', release_artist: 'Art Noir', release_title: 'Silent Green', album_track_title: 'Track One', catalog_number: '', upc: '', isrc: 'ISRC001', release_date: '' },
      { type: 'album_track', id: '11', release_artist: 'Art Noir', release_title: 'Silent Green', album_track_title: 'Track Two', catalog_number: '', upc: '', isrc: '', release_date: '' }
    ]
    const result = groupByArtist(rows)
    const album = result[0].albums[0]
    expect(album.tracks).toHaveLength(2)
    expect(album.tracks[0].name).toBe('Track One')
    expect(album.tracks[0].isrc).toBe('ISRC001')
    expect(album.tracks[1].name).toBe('Track Two')
    expect(album.tracks[1].isrc).toBeNull()
  })

  test('creates standalone CsvAlbum for track rows (singles)', () => {
    const rows = [
      { type: 'track', id: '5', release_artist: 'Art Noir', release_title: 'My Single', album_track_title: '', catalog_number: '', upc: '999', isrc: 'ISRC-SINGLE', release_date: '2024-03-01' }
    ]
    const result = groupByArtist(rows)
    expect(result[0].albums).toHaveLength(1)
    const album = result[0].albums[0]
    expect(album.title).toBe('My Single')
    expect(album.tracks).toHaveLength(1)
    expect(album.tracks[0].name).toBe('My Single')
    expect(album.tracks[0].isrc).toBe('ISRC-SINGLE')
  })

  test('maps metadata correctly', () => {
    const rows = [
      { type: 'album', id: '42', release_artist: 'Art Noir', release_title: 'Test Album', album_track_title: '', catalog_number: 'CAT-99', upc: '888777', isrc: '', release_date: '2022-12-25' }
    ]
    const result = groupByArtist(rows)
    const album = result[0].albums[0]
    expect(album.catalogNumber).toBe('CAT-99')
    expect(album.upc).toBe('888777')
    expect(album.releaseDate).toBe('2022-12-25')
    expect(album.bandcampId).toBe('42')
    expect(album.licensed).toBe(false)
  })

  test('sets licensed: true on albums from licensed_album rows', () => {
    const rows = [
      { type: 'licensed_album', id: '7', release_artist: 'Art Noir', release_title: 'Licensed One', album_track_title: '', catalog_number: '', upc: '555', isrc: '', release_date: '2021-05-10' }
    ]
    const result = groupByArtist(rows)
    expect(result[0].albums[0].licensed).toBe(true)
  })

  test('deduplicates albums by artist + title + id, keeps first occurrence', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'Dupe Album', album_track_title: '', catalog_number: 'FIRST', upc: '111', isrc: '', release_date: '2023-01-01' },
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'Dupe Album', album_track_title: '', catalog_number: 'SECOND', upc: '222', isrc: '', release_date: '2023-02-02' }
    ]
    const result = groupByArtist(rows)
    expect(result[0].albums).toHaveLength(1)
    expect(result[0].albums[0].catalogNumber).toBe('FIRST')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate album'))
    warnSpy.mockRestore()
  })

  test('stores empty string values as null for optional fields', () => {
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'No Meta', album_track_title: '', catalog_number: '', upc: '', isrc: '', release_date: '' }
    ]
    // Suppress warnings for missing fields
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const result = groupByArtist(rows)
    const album = result[0].albums[0]
    expect(album.catalogNumber).toBeNull()
    expect(album.upc).toBeNull()
    expect(album.releaseDate).toBeNull()
    warnSpy.mockRestore()
  })

  test('logs warnings for albums missing release_date or upc', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'No Date', album_track_title: '', catalog_number: '', upc: '123', isrc: '', release_date: '' },
      { type: 'album', id: '2', release_artist: 'Art Noir', release_title: 'No UPC', album_track_title: '', catalog_number: '', upc: '', isrc: '', release_date: '2023-01-01' }
    ]
    groupByArtist(rows)
    const warnings = warnSpy.mock.calls.map(c => c[0])
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('missing release_date'),
      expect.stringContaining('missing upc')
    ]))
    warnSpy.mockRestore()
  })

  test('bandcampId is stored as a string', () => {
    const rows = [
      { type: 'album', id: '12345', release_artist: 'Art Noir', release_title: 'Test', album_track_title: '', catalog_number: '', upc: '111', isrc: '', release_date: '2023-01-01' }
    ]
    const result = groupByArtist(rows)
    expect(typeof result[0].albums[0].bandcampId).toBe('string')
    expect(result[0].albums[0].bandcampId).toBe('12345')
  })

  test('returns empty array for empty rows', () => {
    expect(groupByArtist([])).toEqual([])
  })

  test('multiple artists with albums and tracks', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = [
      { type: 'album', id: '1', release_artist: 'Art Noir', release_title: 'Album A', album_track_title: '', catalog_number: '', upc: '111', isrc: '', release_date: '2023-01-01' },
      { type: 'album_track', id: '10', release_artist: 'Art Noir', release_title: 'Album A', album_track_title: 'Song 1', catalog_number: '', upc: '', isrc: 'ISRC1', release_date: '' },
      { type: 'album', id: '2', release_artist: 'Amautica', release_title: 'Album B', album_track_title: '', catalog_number: 'CAT-02', upc: '222', isrc: '', release_date: '2023-06-15' },
      { type: 'album_track', id: '20', release_artist: 'Amautica', release_title: 'Album B', album_track_title: 'Song 2', catalog_number: '', upc: '', isrc: '', release_date: '' },
      { type: 'track', id: '3', release_artist: 'Art Noir', release_title: 'Single X', album_track_title: '', catalog_number: '', upc: '333', isrc: 'ISRC-S', release_date: '2024-01-01' }
    ]
    const result = groupByArtist(rows)
    expect(result).toHaveLength(2)

    const artNoir = result.find(a => a.name === 'Art Noir')
    expect(artNoir.albums).toHaveLength(2)
    expect(artNoir.albums[0].tracks).toHaveLength(1)
    expect(artNoir.albums[0].tracks[0].name).toBe('Song 1')
    expect(artNoir.albums[1].title).toBe('Single X')

    const amautica = result.find(a => a.name === 'Amautica')
    expect(amautica.albums).toHaveLength(1)
    expect(amautica.albums[0].tracks[0].name).toBe('Song 2')
    warnSpy.mockRestore()
  })
})
