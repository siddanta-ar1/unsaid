# Implementation decisions

Where this implementation makes a call the blueprint left open, or deviates
from it, the reasoning is recorded here.

## Decisions taken

**Local infrastructure is Docker, not Supabase and R2.**
Postgres and MinIO run from `infra/docker-compose.yml`. MinIO speaks the same
S3 API as Cloudflare R2, so `lib/storage.ts` is unchanged between development
and production — only the endpoint and credentials differ. This keeps
development free, offline-capable, and free of account signups, while the
production target from §22.1 is unchanged.

**Ports 3010 / 3011 / 54332 / 9010 instead of 3000 / 3001 / 54322 / 9000.**
The defaults collided with other projects already running on this machine.

**Drizzle, not Prisma.**
Migrations are plain forward-only SQL that can be reviewed line by line, which
matters more than usual when the review question is "does this migration add a
column that could hold content?". It also has no query engine binary, which
suits the serverless deployment target.

**PBKDF2-SHA256 at 600,000 iterations, not Argon2id.**
Argon2id is the stronger choice on paper, but it is not in the Web Crypto API,
so it would mean shipping a WASM dependency into the one code path where a
supply-chain compromise is unrecoverable. PBKDF2 at the OWASP-recommended
iteration count is available natively in every target browser. `KdfParams` is
versioned, so moving to Argon2id later is a migration, not a rewrite.

**AES-KW for key wrapping.**
Wrapping with AES-KW rather than a second AES-GCM layer means the KEK can be
created non-extractable with usages limited to `wrapKey`/`unwrapKey`. The
browser then structurally prevents the key from being read out, even by our own
code.

**The passphrase verifier wraps a known constant.**
Storing any hash derived from the passphrase would hand an attacker an
offline-crackable target. Instead the server stores a fixed 32-byte value
wrapped under the KEK; verifying means unwrapping it successfully, which
requires the real key.

**Forget deletes the wrapped key before the object.**
If the process dies between the two steps, the content is already
unrecoverable. The failure mode leans toward more privacy, not less.

**`NOT_FOUND` is returned for unauthorized access, never `FORBIDDEN`.**
Distinguishing them would confirm that an id exists, which is an enumeration
oracle. Ownership is part of the SQL `WHERE` clause rather than a check after
the fetch.

**Echo defaults to a stub provider.**
`AI_PROVIDER=echo-stub` makes no network call. The entire Echo flow — consent
gate, safety routing, encrypted storage of the response — is therefore testable
without any content ever leaving the machine. Switching to Claude is one
environment variable.

**Consent is checked per version, not per boolean.**
Accepting version 1 of the AI disclosure does not grant version 2. If the
wording in `ReflectConsentSheet` changes materially, bump
`CURRENT_AI_CONSENT_VERSION` — what the user agreed to is the text, not the flag.

**The vault key is never persisted, not even to sessionStorage.**
Closing the tab locks the vault. The session token is persisted, because on its
own it only fetches ciphertext.

**The client builds the anchor transaction; the server only supplies the
commitment.** The blueprint's §17.2 sketches `POST /v1/solana/anchor` as
"prepare on-chain anchor transaction". Assembling it server-side would mean the
API needs an RPC connection and a view of the wallet, for no benefit. Instead
the server returns the commitment it derived from the ciphertext hash it already
holds — so a client cannot anchor an arbitrary value — and the browser builds,
the wallet signs and submits. No signing key is ever near our code.

**The PDA seed is a digest of the thought id, not the id itself.** PDA seeds are
recoverable from public chain data. Using the raw application id would let anyone
who ever saw one of our identifiers link it to on-chain activity, which is
exactly the correlation risk in §13.2. `deriveThoughtSeed` domain-separates it.

**The wallet lives in settings, and its provider only observes.** The provider is
mounted in the root layout so settings and the proof panel share one selection,
but it opens no connection and requests no permission until the user presses
Connect. A signature is requested only when anchoring, never on page load.

## Verified in this implementation

- Crypto envelope: 20 unit tests including tamper detection, IV reuse, key
  rotation, and cryptographic forgetting.
- Full capture → save → open → delete → forget cycle against real Postgres and
  real S3-compatible storage, plus IDOR and consent-gate tests.
- A plaintext canary written through the browser appears in **zero** of: API
  logs, web server logs, a full `pg_dump`, and the raw stored objects.
- The Anchor program compiles to BPF bytecode (`target/deploy/unsaid.so`).
- Solana client: PDA determinism, instruction layout, account decoding.

## Not yet done

- **On-chain deploy and soak test.** The program builds to BPF and the client
  builds a real, signable transaction against it, but nothing has been submitted
  to a validator. This machine's root filesystem is at 99% capacity and
  `solana-test-validator` preallocates a large ledger, so running one risked
  breaking the running Postgres and MinIO containers. Run `solana-test-validator`
  and `solana program deploy target/deploy/unsaid.so` once there is headroom,
  then set `SOLANA_PROGRAM_ID` to the deployed address.

- **The wallet UI has not been exercised against a real wallet extension.** It
  typechecks, is bundled, and the API side is covered by integration tests, but
  the connect → sign → confirm path needs a browser with a wallet installed. The
  Chrome extension driving this session disconnected before that could be run.
- **Mobile (Expo).** Phase 4 in the blueprint.
- **Anonymous social layer.** Deliberately out of MVP scope (§9.3).
- **Key recovery beyond the passphrase.** Listed as an open decision in §29.2
  and still open here; today, a lost passphrase means permanently lost content,
  and the Privacy Centre says so plainly.
- **Independent security review** before the program's upgrade authority is
  moved to a production signer.
