# API Setup Guide

This guide covers how to obtain credentials for each external service used by the Label Site Generator.

---

## Bandcamp (required)

Used to fetch your label's artist roster and album data.

1. Log in to your Bandcamp label account
2. Go to **Settings → API Access**
3. Copy your **Client ID** and **Client Secret**
4. Add to `.env`:
   ```
   BANDCAMP_CLIENT_ID=your_client_id
   BANDCAMP_CLIENT_SECRET=your_client_secret
   BANDCAMP_LABEL_URL=https://your-label.bandcamp.com/
   ```

Note: API access is only available to Bandcamp label accounts, not individual artist accounts. Without credentials the generator falls back to HTML scraping.

---

## Spotify (optional — legacy mode only)

Used as fallback enrichment when Soundcharts credentials are not configured. Not needed when using Soundcharts mode.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **Create App**
4. Set a name (e.g. "Label Site Generator") and description
5. Set Redirect URI to `http://127.0.0.1` (not used but required)
6. Copy **Client ID** and **Client Secret**
7. Add to `.env`:
   ```
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

Rate limits: Development Mode apps have a rolling 30-second window. The generator uses 200ms delays between requests. If you hit a long rate limit (hours), wait and retry.

---

## Soundcharts (recommended)

Replaces Spotify/iTunes/Deezer/Tidal as the primary enrichment source. Provides all streaming links, social media links, album metadata (UPC, label, distributor, copyright), and upcoming events in fewer API calls.

1. Go to [developers.soundcharts.com](https://developers.soundcharts.com)
2. Create an account (free tier: 1,000 credits/month, no credit card required)
3. Copy your **App ID** and **API Key** from the dashboard
4. Add to `.env`:
   ```
   SOUNDCHARTS_APP_ID=your_app_id
   SOUNDCHARTS_API_KEY=your_api_key
   ```

Budget: ~434 API calls for an initial full run (18 artists, 181 albums). Incremental runs only process new/changed albums. For sandbox testing, set both values to `soundcharts`.

---

## Tidal (optional)

Used to enrich albums with Tidal streaming links.

1. Go to [developer.tidal.com](https://developer.tidal.com)
2. Sign up / log in
3. Create a new app — select **Platform API** (not User API)
4. Copy **Client ID** and **Client Secret**
5. Add to `.env`:
   ```
   TIDAL_CLIENT_ID=your_client_id
   TIDAL_CLIENT_SECRET=your_client_secret
   ```

The generator uses client credentials flow. Catalog endpoints (albums, artists, search) require no scopes.

---

## Discogs (optional)

Used to find physical release formats (Vinyl, CD) and sell links.

1. Go to [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
2. Click **Generate new token**
3. Copy the personal access token
4. Add to `.env`:
   ```
   DISCOGS_TOKEN=your_token
   ```

Rate limit: 60 requests/minute with a token. The generator uses 1.1s delays between requests.

---

## iTunes / Apple Music (automatic)

No credentials needed. The iTunes Search API is free and unauthenticated. Album lookups use UPC first, then title search as fallback.

---

## Deezer (automatic)

No credentials needed. The Deezer API is free and unauthenticated. Album lookups use UPC first, then title search as fallback.

---

## MusicFetch via RapidAPI (optional)

Used to fill remaining streaming link gaps (Amazon Music, Beatport, SoundCloud etc.).

1. Go to [rapidapi.com](https://rapidapi.com)
2. Sign up / log in
3. Subscribe to [MusicFetch API](https://rapidapi.com/musicfetch-musicfetch-default/api/musicfetch2)
4. Copy your **X-RapidAPI-Key** from the API dashboard
5. Add to `.env`:
   ```
   MUSICFETCH_RAPIDAPI_KEY=your_key
   ```

---

## YouTube Data API v3 (optional)

Used by `--sync-youtube` to automatically find YouTube videos for albums.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Go to **APIs & Services → Library**
4. Search for **YouTube Data API v3** and enable it
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → API Key**
7. Copy the API key
8. (Recommended) Restrict the key to YouTube Data API v3 only
9. Add to `.env`:
   ```
   YOUTUBE_API_KEY=your_api_key
   ```

Quota: 10,000 units/day. Each search costs 100 units = 100 searches/day. The generator only searches albums that don't already have a `videos.json` file.

---

## Google Analytics 4 (optional)

Used to add analytics tracking to the generated site.

1. Go to [analytics.google.com](https://analytics.google.com)
2. Create a property for your site
3. Get the **Measurement ID** (starts with `G-`)
4. Add to `.env`:
   ```
   GA_MEASUREMENT_ID=G-XXXXXXXXXX
   ```

---

## AWS S3 + CloudFront (optional)

Used by `--deploy` to sync the generated site to S3 and invalidate CloudFront.

1. Install the [AWS CLI](https://aws.amazon.com/cli/)
2. Run `aws configure` and enter your access key, secret, and region
3. Create an S3 bucket with static website hosting enabled
4. (Optional) Create a CloudFront distribution pointing to the bucket
5. Add to `.env`:
   ```
   AWS_S3_BUCKET=your-bucket-name
   AWS_S3_REGION=eu-central-1
   AWS_CLOUDFRONT_DISTRIBUTION_ID=EXXXXXXXXX
   ```

The S3 bucket needs `s3:PutObject` and `s3:DeleteObject` permissions. CloudFront needs `cloudfront:CreateInvalidation`.

---

## ElasticStage (optional)

Used by `--sync-elasticstage` to sync on-demand vinyl/CD release links.

1. Create a label account at [elasticstage.com](https://elasticstage.com)
2. Publish your releases
3. Add to `.env`:
   ```
   ELASTICSTAGE_LABEL_URL=https://elasticstage.com/your-label
   ```

Note: ElasticStage pages require JavaScript rendering. The sync command reports existing `stores.json` files when scraping fails. Add new releases manually via `content/{artist}/{album}/stores.json`.
