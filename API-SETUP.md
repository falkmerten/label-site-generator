# API Setup

The Label Site Generator works without any API credentials — you get a complete website from Bandcamp data alone. APIs add streaming links and metadata.

## Data Sources

The generator supports three primary data sources (set in `config.json` → `source.primary`):

- **Bandcamp** (default) — Scrapes your Bandcamp page for artist/album data
- **Archive.org** — Fetches CC-licensed releases from Internet Archive collections
- **Spotify** (planned v5.1) — Uses Spotify artist/album data as primary source

## Enrichment Priority

1. **Spotify** (recommended) — Streaming links and album matching. Free developer tier is sufficient.
2. **Last.fm** (recommended) — Artist bios, listener stats, genre tags, similar artists. Free, unlimited.
3. **Discogs** — Physical release formats and sell links. Complements Spotify + Last.fm.

## Spotify (streaming links)

Free tier is sufficient. ~3-5 API calls per artist.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Create an app (any name, any description)
3. Copy Client ID and Client Secret

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

```bash
node generate.js --enrich
```

**Note**: The generator uses a lightweight approach — it fetches the album list from your Spotify artist page and matches titles to your Bandcamp albums. Combined with Last.fm for artist metadata, this covers most enrichment needs.

**Tip**: Add Spotify artist URLs to `config.json` (`links.spotify`) to skip the search step and save API calls.

## Last.fm (artist metadata — recommended)

Provides artist bios, listener/play count stats, genre tags, and similar artist recommendations. Free, unlimited API access.

1. Go to [last.fm/api/account/create](https://www.last.fm/api/account/create)
2. Log in with your Last.fm account (or create one)
3. Fill in the application form (any name, e.g. "Label Site Generator")
4. Copy your **API Key**

```env
LASTFM_API_KEY=your_api_key
```

```bash
node generate.js --enrich
```

No rate limit concerns for typical label usage. Last.fm allows up to 5 requests/second.

## Discogs (physical releases)

Adds physical format information (Vinyl, CD, Cassette) and Discogs sell links.

1. Go to [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
2. Generate a personal access token

```env
DISCOGS_TOKEN=your_token
```

## Tidal (streaming links)

Adds Tidal streaming links. Requires a free developer account.

1. Go to [developer.tidal.com](https://developer.tidal.com)
2. Create an application
3. Copy Client ID and Client Secret

```env
TIDAL_CLIENT_ID=your_client_id
TIDAL_CLIENT_SECRET=your_client_secret
```

## YouTube (video embeds)

Enables YouTube video embedding and channel sync on artist pages.

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create a project and enable the YouTube Data API v3
3. Create an API key

```env
YOUTUBE_API_KEY=your_api_key
```

## Gap-Fill APIs (automatic, no credentials needed)

During `--enrich`, the generator automatically queries these services to fill streaming links that Spotify didn't return. No API keys required:

- **Apple Music / iTunes** — UPC lookup via iTunes Search API (free, no auth)
- **Deezer** — UPC lookup via Deezer public API (free, no auth)
- **MusicFetch** — Amazon Music and other platform links (free, no auth)

These run automatically after Spotify enrichment. If a link is already present, the gap-fill skips it.

## Ghost CMS (news)

Optional headless CMS for news articles. When configured, Ghost is the exclusive news source. Falls back to local `content/news/` files if Ghost is unavailable.

1. Set up a Ghost instance (self-hosted or Ghost Pro)
2. Create a Custom Integration in Ghost Admin → Integrations
3. Copy the Content API Key

```env
GHOST_URL=https://news.your-label.com
GHOST_CONTENT_API_KEY=your_content_api_key
```

## Newsletter (Keila / Sendy / Listmonk)

Configure in `content/config.json`:

```json
"newsletter": {
  "provider": "keila",
  "actionUrl": "https://news.your-label.com",
  "formId": "nfrm_xxxxx"
}
```

API credentials for campaign auto-creation (optional):

```env
NEWSLETTER_API_TOKEN=your_api_token
```

## AWS Deployment

```env
AWS_S3_BUCKET=your-bucket-name
AWS_S3_REGION=eu-central-1
AWS_CLOUDFRONT_DISTRIBUTION_ID=EXXXXXXXXX
```

Requires AWS CLI configured with appropriate credentials (`aws configure`).

## Rate Limiting

The generator handles rate limits automatically:
- **Spotify**: 600ms between calls, exponential backoff on 429
- **Last.fm**: 200ms between calls (limit: 5 req/sec)
- **Tidal**: 600ms between calls
- **Discogs**: 1000ms between calls
- **iTunes/Deezer/MusicFetch**: 300ms between calls (generous public limits)

No configuration needed. If a rate limit is hit, the generator waits and retries. If retries are exhausted for one album, it skips and continues.

## Enrichment Tiers

| Tier | APIs | What you get |
|------|------|-------------|
| None | — | Complete website with Bandcamp links only |
| Basic | Spotify | + Spotify, Apple Music, Deezer links (via gap-fill) |
| Recommended | Spotify + Last.fm + Discogs + Tidal | + All streaming links, bios, tags, listener stats, physical formats |

> **Note**: Soundcharts is not available in the free/GPL version. It requires a paid subscription (the one-time trial of 1,000 credits does not reset). For full metadata enrichment via Soundcharts, see [lsg-pro](https://github.com/Aenaos-Records/lsg-pro).
