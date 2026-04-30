# API Setup

The Label Site Generator works without any API credentials — you get a complete website from Bandcamp data alone. APIs add streaming links and metadata.

## Priority

1. **Soundcharts** (recommended) — One API for everything: all streaming platforms, UPC, ISRCs, labels, social media. Fewer calls, more data.
2. **Spotify** — Streaming links only. Good for getting started, but limited metadata.
3. **Discogs** — Physical release formats and sell links. Complements Spotify or Soundcharts.

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

**Note**: The generator uses a lightweight approach — it fetches the album list from your Spotify artist page and matches titles to your Bandcamp albums. No UPC extraction, no ISRC backfill. For full metadata, use Soundcharts.

**Tip**: Add Spotify artist URLs to `config.json` (`links.spotify`) to skip the search step and save API calls.

## Soundcharts (full metadata — recommended)

Soundcharts provides everything in one API: streaming links for all platforms, UPC, ISRCs, label names, social media links, and event data. One call per album instead of 5+ separate calls to different services.

1. Sign up at [developers.soundcharts.com](https://developers.soundcharts.com)
2. Get your App ID and API Key

```env
SOUNDCHARTS_APP_ID=your_app_id
SOUNDCHARTS_API_KEY=your_api_key
```

```bash
node generate.js --enrich
```

Free tier: 1,000 credits/month (1 credit per API call). A typical label with 100 albums uses ~400 credits on first enrichment, then ~10-20 per month for new releases.

## Discogs (physical releases)

Adds physical format information (Vinyl, CD, Cassette) and Discogs sell links.

1. Go to [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
2. Generate a personal access token

```env
DISCOGS_TOKEN=your_token
```

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
- **Soundcharts**: 1000ms between calls, quota monitoring
- **Discogs**: 1000ms between calls

No configuration needed. If a rate limit is hit, the generator waits and retries. If retries are exhausted for one album, it skips and continues.

## Enrichment Tiers

| Tier | APIs | What you get |
|------|------|-------------|
| None | — | Complete website with Bandcamp links only |
| Basic | Spotify | + Spotify, Apple Music, Deezer links |
| Full | Soundcharts + Discogs | + All platforms, UPC, ISRCs, labels, physical formats, sell links |
