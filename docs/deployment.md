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
