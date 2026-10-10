#!/usr/bin/env node
/**
 * The client-side half of the evaluation (`docs/paper/research-notes.md` §6).
 *
 * Everything here runs on the device in the real product, so it is measured
 * through the same exported functions the app calls — not a reimplementation
 * that could be faster than the thing we ship.
 *
 * Reports median and p95 rather than a mean: the unlock wall is a UX cost paid
 * by one person at a time, and a mean hides the tail that person actually
 * feels.
 *
 * Usage: node scripts/bench-client.mjs [--runs 20] [--json out.json]
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus, totalmem } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = (p) => pathToFileURL(resolve(ROOT, p)).href;

const { createVault, deriveKek, newKdfParams, open, seal, unlockWithPassphrase, PBKDF2_ITERATIONS } =
  await import(from('packages/crypto/dist/index.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const RUNS = Number(arg('runs', 20));

/** Percentile by nearest rank on the sorted sample; p50 is the median. */
function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function stats(samples) {
  return {
    n: samples.length,
    median: percentile(samples, 50),
    p95: percentile(samples, 95),
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

const ms = (n) => `${n.toFixed(1)} ms`;

async function time(fn) {
  const started = performance.now();
  const value = await fn();
  return [performance.now() - started, value];
}

async function sample(label, runs, fn) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const [elapsed] = await time(fn);
    samples.push(elapsed);
    process.stdout.write(`\r  ${label}: ${i + 1}/${runs}`);
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r');
  return stats(samples);
}

const results = {
  measured_at: new Date().toISOString(),
  host: {
    cpu: cpus()[0]?.model?.trim() ?? 'unknown',
    cores: cpus().length,
    memory_gb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    note: 'Desktop class. Mobile figures still outstanding — no device harness yet.',
  },
  pbkdf2_iterations: PBKDF2_ITERATIONS,
};

console.log('Unsaid client benchmarks');
console.log(`host         ${results.host.cpu} · ${results.host.cores} cores · node ${process.version}`);
console.log(`PBKDF2       ${PBKDF2_ITERATIONS.toLocaleString()} iterations (OWASP floor for SHA-256)\n`);

// --- 1. Key derivation: the unlock wall ------------------------------------
const kdf = newKdfParams();
results.key_derivation = await sample('key derivation', RUNS, () => deriveKek('correct horse battery staple', kdf));

console.log('1. Key derivation (PBKDF2-SHA256, 600k)');
console.log(`   median ${ms(results.key_derivation.median)} · p95 ${ms(results.key_derivation.p95)} · n=${RUNS}`);

// --- 2. The whole unlock, as the user experiences it -----------------------
const vault = await createVault('correct horse battery staple');
results.unlock = await sample('unlock', RUNS, () =>
  unlockWithPassphrase('correct horse battery staple', vault.passphrase),
);
console.log('\n2. Full unlock (derive + unwrap the vault key)');
console.log(`   median ${ms(results.unlock.median)} · p95 ${ms(results.unlock.p95)} · n=${RUNS}`);

// Vault creation derives twice — once for the passphrase, once for the
// recovery kit — so it is the slowest thing a user ever waits for.
results.vault_creation = await sample('vault creation', Math.max(5, Math.floor(RUNS / 4)), () =>
  createVault('correct horse battery staple'),
);
console.log('\n3. Vault creation (two derivations: passphrase + recovery kit)');
console.log(`   median ${ms(results.vault_creation.median)} · p95 ${ms(results.vault_creation.p95)} · n=${results.vault_creation.n}`);

// --- 4. Envelope cost against payload size --------------------------------
const SIZES = [
  ['1 KB', 1024],
  ['10 KB', 10 * 1024],
  ['100 KB', 100 * 1024],
  ['1 MB', 1024 ** 2],
  ['10 MB', 10 * 1024 ** 2],
];

console.log('\n4. Envelope cost by payload size (seal = encrypt + wrap + hash)\n');
console.log('   payload     seal      open      seal MB/s   open MB/s   overhead');
console.log('   ' + '-'.repeat(68));

results.envelope = [];
for (const [label, bytes] of SIZES) {
  // Random bytes, not zeroes: AES-GCM is constant-time over content, but a
  // compressible payload would flatter any later transport measurement.
  const plaintext = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 65536) {
    crypto.getRandomValues(plaintext.subarray(i, Math.min(i + 65536, bytes)));
  }

  const runs = bytes >= 1024 ** 2 ? 5 : RUNS;
  const sealSamples = [];
  const openSamples = [];
  let sealed;

  for (let i = 0; i < runs; i += 1) {
    const [sealMs, value] = await time(() => seal(plaintext, vault.vaultKey, 1));
    sealed = value;
    sealSamples.push(sealMs);
    const [openMs] = await time(() => open(sealed.ciphertext, sealed.header, sealed.wrappedKey, vault.vaultKey));
    openSamples.push(openMs);
  }

  const sealStats = stats(sealSamples);
  const openStats = stats(openSamples);
  const mb = bytes / 1024 ** 2;

  // What actually leaves the device for this payload, versus the payload.
  const storedBytes =
    sealed.ciphertext.byteLength +
    JSON.stringify(sealed.header).length +
    JSON.stringify(sealed.wrappedKey).length +
    sealed.contentHash.length;

  const row = {
    label,
    bytes,
    seal: sealStats,
    open: openStats,
    seal_mb_s: mb / (sealStats.median / 1000),
    open_mb_s: mb / (openStats.median / 1000),
    stored_bytes: storedBytes,
    overhead_bytes: storedBytes - bytes,
    overhead_ratio: storedBytes / bytes,
  };
  results.envelope.push(row);

  console.log(
    `   ${label.padEnd(10)} ${ms(sealStats.median).padStart(8)}  ${ms(openStats.median).padStart(8)}  ` +
      `${row.seal_mb_s.toFixed(0).padStart(9)}   ${row.open_mb_s.toFixed(0).padStart(9)}   ` +
      `+${row.overhead_bytes} B`,
  );
}

// --- 5. Storage overhead, stated once in the honest form ------------------
const smallest = results.envelope[0];
results.storage_overhead = {
  fixed_bytes: smallest.overhead_bytes,
  note:
    'AES-GCM adds a 16-byte tag; the rest is the 12-byte IV, the wrapped 256-bit ' +
    'content key, and the JSON that names the algorithms. Constant, not proportional.',
};

console.log('\n5. Storage overhead');
console.log(`   +${smallest.overhead_bytes} bytes per memory, independent of size`);
console.log(`   on a 1 KB thought that is ${((smallest.overhead_ratio - 1) * 100).toFixed(1)}%; on 10 MB of audio, ${(((results.envelope.at(-1).overhead_ratio) - 1) * 100).toFixed(4)}%`);

// --- 6. Receipt size against Solana's transaction limit ------------------
// Field-by-field, from programs/unsaid/src/lib.rs. Anchor prepends an 8-byte
// discriminator to every account.
const RECEIPT_FIELDS = [
  ['anchor discriminator', 8],
  ['recorder (Pubkey)', 32],
  ['receipt_id', 32],
  ['subject (vault digest)', 32],
  ['thought_id (domain-separated)', 32],
  ['attestation (enclave measurement)', 32],
  ['result_hash', 32],
  ['consent_version (u16)', 2],
  ['purpose (u8)', 1],
  ['created_at (i64)', 8],
  ['bump (u8)', 1],
];
const RECORD_FIELDS = [
  ['anchor discriminator', 8],
  ['owner (Pubkey)', 32],
  ['thought_id', 32],
  ['commitment', 32],
  ['version / status / access_mode (u8 ×3)', 3],
  ['created_at (i64)', 8],
  ['updated_at (i64)', 8],
  ['bump (u8)', 1],
];

const sum = (fields) => fields.reduce((t, [, n]) => t + n, 0);
const TX_LIMIT = 1232;

results.account_budget = {
  transaction_limit: TX_LIMIT,
  consent_receipt: { fields: RECEIPT_FIELDS, total: sum(RECEIPT_FIELDS) },
  thought_record: { fields: RECORD_FIELDS, total: sum(RECORD_FIELDS) },
};

console.log('\n6. On-chain account budget (vs the 1,232-byte transaction limit)');
for (const [name, size] of RECEIPT_FIELDS) console.log(`   ${String(size).padStart(4)} B  ${name}`);
console.log(`   ${'-'.repeat(44)}`);
console.log(`   ${String(sum(RECEIPT_FIELDS)).padStart(4)} B  consent receipt — ${((sum(RECEIPT_FIELDS) / TX_LIMIT) * 100).toFixed(1)}% of the limit`);
console.log(`   ${String(sum(RECORD_FIELDS)).padStart(4)} B  thought record  — ${((sum(RECORD_FIELDS) / TX_LIMIT) * 100).toFixed(1)}% of the limit`);
console.log('   Nothing in either is content, so neither grows with what the user wrote.');

const jsonPath = arg('json');
if (jsonPath) {
  await writeFile(resolve(ROOT, jsonPath), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nwrote ${jsonPath}`);
}
