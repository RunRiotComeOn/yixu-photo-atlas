# Yixu’s Photography Atlas

An interactive personal photography map. The public gallery is hosted on GitHub Pages; uploads and persistent storage run on Cloudflare.

## Architecture

- **GitHub Pages** — React/Vite map and iPhone upload interface
- **Cloudflare Worker** — API, expiring QR upload sessions, validation and media delivery
- **Cloudflare R2** — uploaded photo files
- **Cloudflare D1** — coordinates, captions, dates and upload-session metadata

The browser never contains the private upload key. The owner enters it only when unlocking a short-lived QR code, and the Worker validates it against the `ADMIN_TOKEN` secret.

## Deploy the frontend

GitHub Actions publishes `main` automatically. In **Settings → Pages**, choose **GitHub Actions** as the source.

After the Worker is deployed, add a repository variable named `VITE_API_BASE` whose value is the Worker origin, for example `https://yixu-photo-atlas-api.example.workers.dev`.

## Deploy the Cloudflare backend

1. In Cloudflare Dashboard, open **Workers & Pages → Create → Import a repository**.
2. Select this repository and use `worker/wrangler.jsonc` as the Wrangler configuration.
3. Allow Cloudflare to provision the declared D1 database and R2 bucket.
4. Apply `worker/migrations/0001_initial.sql` to the new D1 database.
5. Add a secret named `ADMIN_TOKEN` with a long private value.
6. Deploy, then set the resulting Worker URL as GitHub's `VITE_API_BASE` repository variable.

Never commit `ADMIN_TOKEN`, Cloudflare API tokens, or local `.dev.vars` files.

## Local development

```bash
npm install
npm run dev
```

To test the Worker locally, add `ADMIN_TOKEN` to `.dev.vars`, apply the migration to local D1, and run Wrangler with `worker/wrangler.jsonc`.
