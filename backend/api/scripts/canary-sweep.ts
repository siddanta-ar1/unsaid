#!/usr/bin/env tsx
/**
 * The falsifiable claim, run as a protocol rather than asserted.
 *
 * Writes N uniquely marked memories through the real client path — sealed on
 * the "device", ciphertext PUT straight to object storage, metadata registered
 * with the API — and then goes looking for those markers in every place the
 * data could have leaked:
 *
 *   1. the entire database, as a full `pg_dump` (not a hand-listed set of
 *      tables, so a column added tomorrow is covered by this too)
 *   2. every byte of every object in the bucket
 *   3. the API's own logs for the run
 *
 * Zero hits is the claim. The run also decrypts one memory back and checks the
 * marker is there, because a sweep that finds nothing because nothing was
 * saved would pass while proving the opposite of what it claims.
 *
 * Usage, from the repo root:
 *   pnpm --filter @unsaid/api canary
 *   pnpm --filter @unsaid/api canary -- --n 25 --keep
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createVault, openText, sealText } from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const run = promisify(execFile);

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const N = Number(arg('n', '20'));
const PG_CONTAINER = arg('pg-container', 'unsaid-postgres-1')!;
const MC_IMAGE = 'minio/mc:latest';

/** Unique per run: a stale marker from a previous run would be a false alarm. */
const RUN_ID = randomUUID().replace(/-/g, '').slice(0, 12);
const marker = (i: number) => `UNSAID_CANARY_${RUN_ID}_${String(i).padStart(3, '0')}`;

const PASSPHRASE = 'the canary run passphrase, never stored anywhere';

const bold = (s: string) => `\u001b[1m${s}\u001b[0m`;
const green = (s: string) => `\u001b[32m${s}\u001b[0m`;
const red = (s: string) => `\u001b[31m${s}\u001b[0m`;

console.log(bold('\nUnsaid plaintext canary sweep'));
console.log(`run id       ${RUN_ID}`);
console.log(`canaries     ${N}`);
console.log(`protocol     write through the real client, then sweep db + storage + logs\n`);

// The API logs to stdout; capture them so they can be swept like anything else.
const capturedLogs: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
let capturing = false;
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  if (capturing && typeof chunk === 'string') capturedLogs.push(chunk);
  // @ts-expect-error - passthrough to the real signature
  return originalWrite(chunk, ...rest);
}) as typeof process.stdout.write;

let app: FastifyInstance | undefined;
let userId = '';
let failures = 0;

try {
  capturing = true;
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  const vault = await createVault(PASSPHRASE);
  const kek = vault.vaultKey;

  const identity = await app.inject({
    method: 'POST',
    url: '/v1/identity/guest',
    payload: {
      passphrase: vault.passphrase,
      recovery: vault.recovery,
      loginProof: vault.loginProof,
    },
  });
  if (identity.statusCode !== 201) {
    throw new Error(`Could not create the vault: ${identity.statusCode} ${identity.body}`);
  }
  const { token, userId: id } = identity.json() as { token: string; userId: string };
  userId = id;
  const auth = () => ({ authorization: `Bearer ${token}` });

  // --- write N canaries through the path a real device uses ----------------
  // Timed on the way through: this is the end-to-end save latency of §6, and
  // it is the same code path, so measuring it separately would measure a
  // different program.
  const written: { id: string; text: string }[] = [];
  const saveLatencies: number[] = [];
  const sealLatencies: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const text = `${marker(i)} — this sentence must never appear in any store.`;
    const saveStarted = performance.now();
    const sealStarted = performance.now();
    const sealed = await sealText(text, kek, 1);
    sealLatencies.push(performance.now() - sealStarted);

    const intentRes = await app.inject({
      method: 'POST',
      url: '/v1/thoughts/intents',
      headers: auth(),
      payload: {
        type: 'text',
        byteSize: sealed.ciphertext.byteLength,
        contentHash: sealed.contentHash,
      },
    });
    if (intentRes.statusCode !== 201) throw new Error(`intent ${i}: ${intentRes.body}`);
    const intent = intentRes.json() as { intentId: string; uploadUrl: string };

    const put = await fetch(intent.uploadUrl, {
      method: 'PUT',
      body: sealed.ciphertext as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (!put.ok) throw new Error(`upload ${i}: ${put.status}`);

    const registerRes = await app.inject({
      method: 'POST',
      url: '/v1/thoughts',
      headers: auth(),
      payload: { intentId: intent.intentId, wrappedKey: sealed.wrappedKey, header: sealed.header },
    });
    if (registerRes.statusCode !== 201) throw new Error(`register ${i}: ${registerRes.body}`);
    saveLatencies.push(performance.now() - saveStarted);
    written.push({ id: (registerRes.json() as any).thought.id, text });
    process.stdout.write(`\r  wrote ${i + 1}/${N}`);
  }
  process.stdout.write('\r' + ' '.repeat(30) + '\r');
  console.log(`${green('✓')} wrote ${N} canaries through the real client path`);

  const pct = (xs: number[], p: number) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
  };
  console.log(
    `  end-to-end save: median ${pct(saveLatencies, 50).toFixed(0)} ms · ` +
      `p95 ${pct(saveLatencies, 95).toFixed(0)} ms ` +
      `(of which sealing ${pct(sealLatencies, 50).toFixed(1)} ms) — local infrastructure, n=${N}`,
  );

  // --- the control: the user can still read one back ----------------------
  // Without this the sweep below is unfalsifiable.
  const first = written[0]!;
  const getRes = await app.inject({ method: 'GET', url: `/v1/thoughts/${first.id}`, headers: auth() });
  const { thought } = getRes.json() as { thought: { downloadUrl: string; header: any; wrappedKey: any } };
  const ciphertext = new Uint8Array(await (await fetch(thought.downloadUrl)).arrayBuffer());
  const recovered = await openText(ciphertext, thought.header, thought.wrappedKey, kek);
  const controlOk = recovered.includes(marker(0));
  console.log(
    `${controlOk ? green('✓') : red('✗')} control: the owner decrypted memory 1 and the marker is there`,
  );
  if (!controlOk) failures += 1;

  capturing = false;

  // --- sweep 1: the entire database ---------------------------------------
  console.log(bold('\nsweep 1 — the whole database (pg_dump)'));
  const dump = await run(
    'docker',
    ['exec', PG_CONTAINER, 'pg_dump', '-U', 'unsaid', '-d', 'unsaid'],
    { maxBuffer: 1024 * 1024 * 512 },
  );
  const dumpHits = countHits(dump.stdout, N);
  console.log(`  dumped       ${(dump.stdout.length / 1024).toFixed(0)} KB of SQL, every table`);
  report('markers found in the database', dumpHits);
  if (dumpHits.total > 0) failures += 1;

  // --- sweep 2: every byte in the bucket ----------------------------------
  // Mirrored out and read here rather than piped through the container: the
  // mc image has no `sed`, and the first version of this swept an empty pipe
  // and called it clean. An empty sweep now fails loudly instead (below).
  console.log(bold('\nsweep 2 — every object in storage'));
  const bucket = process.env.S3_BUCKET ?? 'unsaid-private';
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9010';
  const mirror = await mkdtemp(join(tmpdir(), 'unsaid-canary-'));

  // Runs as the invoking uid so the mirrored files are readable here, with
  // HOME redirected because that uid has no home inside the image and mc
  // refuses to start without somewhere to write its config.
  await run('docker', [
    'run', '--rm', '--network', 'host', '--user', `${process.getuid?.() ?? 1000}`,
    '-e', 'HOME=/tmp', '-v', `${mirror}:/out`, '--entrypoint', 'sh', MC_IMAGE, '-c',
    `mc alias set local ${endpoint} ${process.env.S3_ACCESS_KEY_ID} ${process.env.S3_SECRET_ACCESS_KEY} >/dev/null && ` +
      `mc mirror --quiet --overwrite local/${bucket} /out`,
  ]);

  let objectCount = 0;
  let objectBytesRead = 0;
  let objectText = '';
  for (const file of await readdir(mirror, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const bytes = await readFile(join(file.parentPath ?? mirror, file.name));
    objectCount += 1;
    objectBytesRead += bytes.length;
    objectText += new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  await rm(mirror, { recursive: true, force: true });

  const objectHits = countHits(objectText, N);
  console.log(`  read         ${objectCount} objects, ${(objectBytesRead / 1024).toFixed(0)} KB of bytes`);
  report('markers found in object storage', objectHits);
  if (objectHits.total > 0) failures += 1;

  // A sweep that read nothing proves nothing. There are at least N objects in
  // that bucket, because this run just wrote them.
  if (objectCount < N) {
    console.log(`  ${red('✗')} only ${objectCount} objects were read, but ${N} were written — the sweep is not valid`);
    failures += 1;
  }

  // --- sweep 3: the API's own logs ----------------------------------------
  console.log(bold('\nsweep 3 — the API logs for this run'));
  const logText = capturedLogs.join('');
  const logHits = countHits(logText, N);
  console.log(`  captured     ${(logText.length / 1024).toFixed(0)} KB of log output`);
  report('markers found in the logs', logHits);
  if (logHits.total > 0) failures += 1;

  if (!has('keep')) {
    await getDatabase().delete(users).where(eq(users.id, userId));
    userId = '';
    console.log('\ncleaned up the canary vault.');
  } else {
    console.log(`\nkept the canary vault (${userId}) for inspection.`);
  }
} finally {
  capturing = false;
  process.stdout.write = originalWrite;
  if (userId && !has('keep')) {
    try {
      await getDatabase().delete(users).where(eq(users.id, userId));
    } catch {
      /* the report matters more than the cleanup */
    }
  }
  await app?.close();
}

/** Counts how many of the run's markers appear, and how many times in total. */
function countHits(haystack: string, n: number) {
  let distinct = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const m = marker(i);
    let from = 0;
    let found = 0;
    for (;;) {
      const at = haystack.indexOf(m, from);
      if (at === -1) break;
      found += 1;
      from = at + m.length;
    }
    if (found) distinct += 1;
    total += found;
  }
  // The run id alone would also be damning, even without a full marker.
  const idHits = haystack.split(RUN_ID).length - 1;
  return { distinct, total, idHits };
}

function report(label: string, hits: { distinct: number; total: number; idHits: number }) {
  const clean = hits.total === 0 && hits.idHits === 0;
  console.log(`  ${clean ? green('✓') : red('✗')} ${label}: ${hits.total} (${hits.distinct}/${N} distinct)`);
  if (hits.idHits) console.log(`  ${red('✗')} the run id itself appears ${hits.idHits} times`);
}

console.log(
  failures === 0
    ? green(bold('\nCLEAN — the plaintext never crossed the backend boundary.\n'))
    : red(bold(`\n${failures} SWEEP(S) FAILED — the invariant is broken.\n`)),
);
process.exit(failures === 0 ? 0 : 1);
