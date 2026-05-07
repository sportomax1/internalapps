# Oura Ring Sleep Trends SPA

Single-user, iPhone-first Oura Ring sleep trends dashboard.

The app shows bedtime, wake time, total sleep, and sleep score trends with summary cards, vanilla canvas charts, auto insights, a bedtime-vs-wake correlation chart, raw exports, local cache fallback, and debug logs.

## Files

- `index.html` - source copy of the single-file vanilla HTML/CSS/JavaScript SPA
- `public/index.html` - served copy for Vercel because this repo already uses `public/`
- `public/apps.html` - preserved copy of the previous internal apps portal
- `api/oura.js` - Vercel serverless proxy that keeps `OURA_KEY` server-side
- `vercel.json` - existing Vercel static config

The older `public/oura.html` explorer is still present and was not replaced.

## Add `OURA_KEY`

Create a personal access token in the Oura Cloud developer portal, then add it to Vercel as an environment variable:

```txt
OURA_KEY=your_oura_token_here
```

In Vercel:

1. Open the project.
2. Go to Settings -> Environment Variables.
3. Add `OURA_KEY`.
4. Redeploy.

The frontend never receives this key. It only calls `/api/oura`.

## Local Testing

Install and run Vercel locally:

```bash
npm i -g vercel
vercel dev
```

Then open:

```txt
http://localhost:3000
```

For local API testing, add `OURA_KEY` to `.env.local`:

```txt
OURA_KEY=your_oura_token_here
```

## Deployment

Deploy normally with Vercel:

```bash
vercel
```

or connect this repo to a Vercel project and deploy from Git.

## Common Errors

- `Oura key missing in Vercel.` - `OURA_KEY` is not set for the deployment environment.
- `Unauthorized. Check OURA_KEY.` - the token is missing, expired, revoked, malformed, or does not have the required scopes.
- `Oura rate limit hit.` - wait a few minutes and refresh.
- `Bad JSON from /api/oura.` - the API route returned a non-JSON response; check Vercel function logs.
- `Using cache` - the live API failed, so the app loaded the last successful response from `localStorage`.
- Empty charts - no sleep records were returned for the selected date range.

## Debugging

Open Settings and turn on Debug mode. The app logs:

- App loaded
- Fetch started
- API response
- Records loaded
- Cache hit/miss
- Chart rendered
- Error details
- Export events

The Vercel function also logs API calls, response counts, normalization results, and helpful error details.

## Oura API Notes

The API route uses Oura API v2 endpoints under:

```txt
https://api.ouraring.com/v2/usercollection
```

It fetches `sleep` records and merges `daily_readiness` when available.

Official docs:

- https://cloud.ouraring.com/docs/authentication
- https://cloud.ouraring.com/docs/error-handling
