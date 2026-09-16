# Deployment

Everything here is written and tested except the steps that need your
credentials. Those are marked **[needs your account]** and are the only work
left before there is a public URL.

## Shape

```
  Vercel (sin1)              Fly.io (sin)              Supabase
  apps/web                   backend/api               Postgres
  Next.js, static landing ──▶ Fastify, always-on ─────▶ metadata only
                                    │
                                    ▼
                             Cloudflare R2
                             encrypted objects
```

The API is an always-on container rather than serverless: the Postgres pool and
the S3 signing client both behave better with a warm process, and this is one
small service with no bursty traffic to justify the trade.

Both regions are Singapore — the closest either platform gets to Nepal.

## 1. Database — **[needs your account]**

Create a Supabase project, then from `backend/api`:

```bash
DATABASE_URL='postgres://...supabase.co:5432/postgres' pnpm db:migrate
```

Migrations are forward-only and have been applied cleanly from empty three
times locally.

## 2. Object storage — **[needs your account]**

Create a Cloudflare R2 bucket named `unsaid-private`.

- **Public access: off.** Clients never touch the bucket directly except
  through a signed URL that expires in five minutes.
- **Object versioning: off.** Versioning silently preserves objects the user
  asked us to delete, which would make the Privacy Centre's deletion promise
  false. This is a correctness requirement, not a preference.
- Create an API token scoped to that one bucket.

The storage adapter already speaks S3, so only the endpoint and credentials
change between MinIO locally and R2 in production.

**CORS is not optional.** The browser PUTs ciphertext straight to the bucket
(`apps/web/src/lib/api.ts:48`), and it sends `content-type:
application/octet-stream` — not a CORS-safelisted value, so every upload is
preceded by a preflight. Without this policy the bucket rejects the preflight
and no memory can ever be saved, while everything else looks healthy:

```json
[
  {
    "AllowedOrigins": ["https://unsaid.app", "https://<project>.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

List every origin that will serve the app, preview URLs included — the origin
is matched exactly.

**The S3 endpoint lags activation.** For several minutes after R2 is first
enabled, `https://<account>.r2.cloudflarestorage.com` resolves but fails the
TLS handshake with `alert 40` — the certificate has not been issued yet. The
REST API works before the S3 endpoint does, so a bucket can exist while uploads
still fail. Wait and retry rather than re-cutting credentials.

**Checksums are disabled deliberately.** `backend/api/src/lib/storage.ts` sets
`requestChecksumCalculation: 'WHEN_REQUIRED'`. Since v3.729 the AWS SDK adds
CRC32 parameters to every request including pre-signed URLs, which R2 rejects.
MinIO tolerates them, so the failure would appear only against the real bucket.
Nothing is lost: objects are AES-GCM with an authentication tag, so integrity
is the envelope's guarantee rather than the transport's.

## 3. API — **[needs your account]**

```bash
fly launch --no-deploy          # once, to claim the app name
fly secrets set \
  DATABASE_URL='postgres://...' \
  SESSION_SECRET="$(openssl rand -base64 48)" \
  S3_ENDPOINT='https://<account>.r2.cloudflarestorage.com' \
  S3_BUCKET='unsaid-private' \
  S3_ACCESS_KEY_ID='...' \
  S3_SECRET_ACCESS_KEY='...' \
  CORS_ORIGIN='https://unsaid.app'
fly deploy
```

`fly.toml` health-checks `/ready`, which reaches Postgres and the bucket — so a
machine with a broken dependency is replaced rather than left serving errors.

The container image builds and runs locally today; only the secrets are missing.

## 4. Web — **[needs your account]**

```bash
vercel link          # from apps/web
vercel env add NEXT_PUBLIC_API_URL production          # https://unsaid-api.fly.dev
vercel env add NEXT_PUBLIC_STORAGE_ORIGIN production   # https://<account>.r2.cloudflarestorage.com
vercel env add NEXT_PUBLIC_SOLANA_NETWORK production   # devnet
vercel --prod
```

`NEXT_PUBLIC_STORAGE_ORIGIN` is not optional: it is compiled into the Content
Security Policy's `connect-src`, and ciphertext uploads will be blocked by the
browser without it.

## What now refuses to deploy

Three failures used to be possible and silent. They are now impossible.

| Guard | Where | Stops |
|---|---|---|
| Production origins | `apps/web/next.config.ts` | A production build whose `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_STORAGE_ORIGIN` are unset or `http://`. These are compiled into the CSP, so the old behaviour was a site that loaded perfectly and could not reach its own API. Only fires when `VERCEL_ENV=production`, so local builds and previews are untouched. |
| Placeholder secret | `backend/api/src/lib/config.ts` | Booting production with the `SESSION_SECRET` from `.env.example`. It is 51 characters, so the `>=48` floor passed it — and a published signing secret forges every session there is. |
| Localhost in production | `backend/api/src/lib/config.ts` | A production `DATABASE_URL` or `S3_ENDPOINT` still pointed at the developer's machine. |

Each is covered by a test in `backend/api/src/lib/config.test.ts`.

### Why the install is forced

`apps/web/vercel.json` runs `pnpm install --frozen-lockfile --force`. The
`--force` is load-bearing on every deploy after the first.

pnpm links workspace packages as symlinks — `node_modules/@unsaid/types` points
at `packages/types`. Vercel restores `node_modules` from its build cache, and
pnpm then reports `Already up to date` and does no work, but the symlinks do not
survive the cache archive intact. The build fails with `Module not found: Can't
resolve '@unsaid/types'` for every workspace import, on a commit that built
cleanly the first time.

The first deploy of a project always passes, because there is no cache to
restore. The second fails. `--force` makes the install rebuild the modules
directory regardless of what the cache handed it.

## 5. Verify before inviting anyone

```bash
curl https://unsaid-api.fly.dev/ready        # expect 200 and both checks ok
```

Then, in a fresh browser profile against the production URL:

1. Create a vault, save the recovery kit.
2. Write something, save it, reopen it.
3. Export the vault; confirm the archive opens.
4. Sign out, then recover using only the kit.
5. Delete a memory, then forget one.

Step 4 is the one that matters. It is the only path a real user will take at
their worst moment, and the only one nobody tests by accident.

## Keeping credentials out of the repository

`node scripts/scan-secrets.mjs --all` runs pre-commit and in CI. It knows the
shapes of Vercel (`vcp_`) and Supabase (`sbp_`, and service-role JWTs) tokens,
and it catches the unquoted `KEY=value` form that a `.env` file actually uses —
the earlier rule only matched quoted values and would have missed it.

Credentials belong in `fly secrets set` and `vercel env add`. Never in a file
in this repository, and never pasted into a chat window: a token that has been
in a transcript is a token to rotate, not a token to deploy with.

## Rotating a leaked secret

`SESSION_SECRET` — set a new one and redeploy. Every session is invalidated;
users unlock again with their phrase. No content is affected.

**Storage credentials** — issue a new R2 token, `fly secrets set`, then revoke
the old one. Signed URLs already issued stay valid until they expire (five
minutes), which is the reason the TTL is short.

**Database credentials** — rotate in Supabase, then `fly secrets set`. Content
is unaffected either way: the database holds no readable memory.

Note what is *not* on this list. There is no key to rotate that would expose
user content, because we never hold one.
