# Internal Apps

Collection of small personal/internal web tools served from Vercel.

## Places

`/places/` is a password-protected Leaflet map backed by Supabase. Its browser
code talks only to `/api/places`; the Supabase server key never reaches the
client.

Required Vercel variables:

```txt
APP_PASSWORD=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Apply `supabase/migrations/20260629214440_places_secure_table.sql` to the linked
Supabase project before deploying. The migration preserves the existing
`places` table, enables RLS, removes public CRUD policies, and grants access only
to the server-side service role.

## BGA SFTP Explorer

`/sftp/` is a read-only FileZilla-style browser for Board Game Arena Studio SFTP.
The SPA calls `/api/sftp`, which is hard-restricted to
`1.studio.boardgamearena.com:2022` and supports connection testing, directory
listing, text/code preview, and small-file download.

### Recommended saved-credential mode

Set these Vercel environment variables:

```txt
APP_PASSWORD=your_internal_apps_password
SFTP_USERNAME=your_bga_studio_username
SFTP_PASSWORD=your_bga_studio_sftp_password
```

Then open `/sftp/`, leave **Saved Vercel secret** selected, and enter only the
Internal Apps password. The browser never receives `SFTP_PASSWORD`. After the
Internal Apps password is verified, the API returns a short-lived signed token
kept only in the current browser tab; subsequent SFTP calls use that token while
the Vercel function reads `SFTP_PASSWORD` server-side.

`SFTP_USERNAME` is optional if the user is entered manually in the SPA.

If BGA Studio password authentication is disabled because an SSH key was
uploaded, saved mode can use:

```txt
SFTP_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----...
SFTP_PASSPHRASE=
SFTP_AUTH_METHOD=key
```

The private key never leaves Vercel. If both `SFTP_PRIVATE_KEY` and
`SFTP_PASSWORD` are configured and `SFTP_AUTH_METHOD` is blank, key
authentication is preferred. Set `SFTP_AUTH_METHOD=password` to force password
auth.

### Manual mode

Manual mode remains available. The SFTP username/password stay only in the
current browser tab's memory and are sent over HTTPS for each operation.
If `APP_PASSWORD` (or `PERSONAL_PASSWORD`) is configured, the SFTP endpoint is
also protected by the Internal Apps password in manual mode.

### Security / architecture

- The backend is locked to the BGA Studio hostname and port to avoid becoming a
  generic TCP/SFTP proxy.
- The API is read-only: no upload, edit, rename, delete, mkdir, chmod, or write
  operation exists.
- SFTP secrets and private keys are never returned by the API or written to
  application logs.
- Each request opens and closes SFTP because Vercel Functions are stateless.
- The browser unlock token expires after one hour and is kept only in memory.

Normal Vercel Function responses have a 4.5 MB payload ceiling, so SFTP downloads
are capped at 4 MB and text previews return at most 1 MB. Use the local bridge
version when larger downloads are required.

## Oura

The consolidated `/api/oura` function keeps `OURA_KEY` server-side and supports
the existing Oura trends, sleep-score, and key-status routes through internal
dispatch/rewrites.

Add the Vercel variable:

```txt
OURA_KEY=your_oura_token_here
```

The frontend never receives the key.

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

Use `.env.local` for development-only environment variables. Never commit real
secrets.

## Deployment

Deploy normally with Vercel:

```bash
vercel
```

or connect this repo to the existing Vercel project and deploy from Git.
