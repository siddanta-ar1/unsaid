#!/usr/bin/env node
/**
 * The on-chain half of the evaluation (`docs/paper/research-notes.md` §6):
 * what a consent receipt actually costs, and how long a user waits for it.
 *
 * One receipt tells you almost nothing — a single confirmation can land in
 * 300 ms or 3 s depending on where in the slot it arrived. The deployability
 * question is the distribution, so this writes N of them and reports the
 * spread, then converts it into the number that decides the business: cost per
 * user per month at a stated reflection rate.
 *
 * Receipts are written sequentially and each is confirmed before the next is
 * sent, which is both what the product does and the only way the latency
 * figure means anything.
 *
 * The public devnet RPC rate-limits hard (429) well before 100 receipts, so
 * every call goes through `withRetry` and the loop paces itself. Cost is read
 * from the balance once at each end rather than per receipt: rent and fee are
 * fixed by the account layout, so a per-receipt probe bought three times the
 * RPC traffic for a number that cannot vary.
 *
 * Usage: node scripts/bench-chain.mjs [--n 100] [--rpc URL] [--json out.json]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = (p) => pathToFileURL(resolve(ROOT, p)).href;

const {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} = await import(from('apps/web/node_modules/@solana/kit/dist/index.node.mjs'));

const { deriveThoughtSeed, fromBase64Url, toBase64Url, sha256, encodeUtf8 } = await import(
  from('packages/crypto/dist/index.js')
);
const { Purpose, UNSAID_PROGRAM_ID, decodeConsentReceipt, deriveReceiptAddress, recordConsentInstruction } =
  await import(from('packages/solana/dist/index.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const N = Number(arg('n', 100));
const RPC_URL = arg('rpc', 'https://api.devnet.solana.com');
const PROGRAM_ID = arg('program', process.env.SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID);

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, 'ws'));
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

const secret = Uint8Array.from(
  JSON.parse(await readFile(arg('keypair', join(homedir(), '.config', 'solana', 'id.json')), 'utf8')),
);
const recorder = await createKeyPairSignerFromBytes(secret);

const vaultId = randomUUID();
const subject = new Uint8Array(await sha256(encodeUtf8(`unsaid:subject:v1:${vaultId}`)));
const resultHash = new Uint8Array(await sha256(encodeUtf8('a reflection nobody but the user will read')));

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

const sleep = (msec) => new Promise((r) => setTimeout(r, msec));

/** Every backoff we were forced into, reported so the pacing is visible. */
const throttles = [];

/**
 * Retries a throttled RPC call with exponential backoff.
 *
 * A 429 is the public endpoint saying "slow down", not a property of the
 * program, so counting it as a failed receipt would understate reliability.
 * Anything that is not a rate limit is rethrown immediately — a real error
 * should surface on the first attempt, not after four more.
 */
async function withRetry(label, fn, attempts = 6) {
  let delay = 500;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const text = String(error?.message ?? error);
      const throttled = /429|Too Many Requests|rate/i.test(text);
      if (!throttled || attempt >= attempts) throw error;
      throttles.push({ label, attempt, delay });
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
    }
  }
}

console.log('Unsaid on-chain benchmarks');
console.log(`cluster      ${RPC_URL}`);
console.log(`program      ${PROGRAM_ID}`);
console.log(`recorder     ${recorder.address}`);
console.log(`receipts     ${N}, written one at a time, each confirmed before the next\n`);

const openingBalance = await withRetry('balance', () => rpc.getBalance(recorder.address).send());
console.log(`balance      ${Number(openingBalance.value) / 1e9} SOL\n`);

const PACE_MS = Number(arg('pace', 250));
const latencies = [];
const failures = [];
const verified = [];
let accountBytes = null;
const startedAll = Date.now();

for (let i = 0; i < N; i += 1) {
  const receiptId = new Uint8Array(randomBytes(32));
  const startedAt = Date.now();

  try {
    const thoughtSeed = fromBase64Url(await deriveThoughtSeed(randomUUID()));
    const attestation = new Uint8Array(randomBytes(32));

    const instruction = await recordConsentInstruction({
      recorder: recorder.address,
      receiptId,
      subject,
      thoughtId: thoughtSeed,
      purpose: Purpose.Reflection,
      consentVersion: 1,
      attestation,
      resultHash,
      programAddress: address(PROGRAM_ID),
    });

    const { value: latestBlockhash } = await withRetry('blockhash', () =>
      rpc.getLatestBlockhash().send(),
    );
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(recorder, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstruction(instruction, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    await withRetry('send', () => sendAndConfirm(signed, { commitment: 'confirmed' }));
    getSignatureFromTransaction(signed);

    latencies.push(Date.now() - startedAt);

    // Read a sample back, so the figures describe receipts that exist rather
    // than transactions that were merely accepted. Every tenth, to keep the
    // request budget for the receipts themselves.
    if (i % 10 === 0) {
      const [receiptAddress] = await deriveReceiptAddress(subject, receiptId, address(PROGRAM_ID));
      const { value: account } = await withRetry('read-back', () =>
        rpc.getAccountInfo(receiptAddress, { encoding: 'base64' }).send(),
      );
      const bytes = Buffer.from(account.data[0], 'base64');
      accountBytes = bytes.length;
      const decoded = decodeConsentReceipt(bytes);
      const ok =
        toBase64Url(decoded.subject) === toBase64Url(subject) &&
        toBase64Url(decoded.attestation) === toBase64Url(attestation) &&
        decoded.consentVersion === 1 &&
        decoded.purpose === Purpose.Reflection;
      if (!ok) throw new Error('A receipt read back with fields that do not match what was sent.');
      verified.push(i);
    }
  } catch (error) {
    failures.push({ index: i, error: String(error?.message ?? error).slice(0, 200) });
  }

  const median = latencies.length ? percentile(latencies, 50) : 0;
  process.stdout.write(
    `\r  ${i + 1}/${N} · median ${median} ms · ${failures.length} failed · ${throttles.length} backoffs   `,
  );

  // Deliberate pacing: the public endpoint throttles aggressively, and a
  // benchmark that spends its time in backoff measures the endpoint, not us.
  if (PACE_MS) await sleep(PACE_MS);
}

process.stdout.write('\n');
const wallClock = Date.now() - startedAll;
const closingBalance = await withRetry('balance', () => rpc.getBalance(recorder.address).send());

const totalSpent = Number(openingBalance.value - closingBalance.value);
// Rent and fee are fixed by the account layout, so the per-receipt figure is
// the total divided by what actually landed — not an average over a variable.
const lamports = { per_receipt: latencies.length ? totalSpent / latencies.length : 0 };

// The fee is what recurs; rent is recoverable in principle but these receipts
// are deliberately permanent, so treat the whole thing as the cost.
const perReceiptSol = lamports.per_receipt / 1e9;

const results = {
  measured_at: new Date().toISOString(),
  cluster: RPC_URL,
  program: PROGRAM_ID,
  recorder: recorder.address,
  n_requested: N,
  n_confirmed: latencies.length,
  failures,
  throttle_backoffs: throttles.length,
  read_back_verified: verified.length,
  account_bytes: accountBytes,
  confirmation_ms: {
    median: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    min: Math.min(...latencies),
    max: Math.max(...latencies),
  },
  cost_lamports: lamports,
  cost_sol_per_receipt: perReceiptSol,
  total_spent_sol: totalSpent / 1e9,
  wall_clock_s: wallClock / 1000,
};

console.log('\n--- confirmation time ---');
console.log(`median       ${results.confirmation_ms.median} ms`);
console.log(`p95          ${results.confirmation_ms.p95} ms`);
console.log(`range        ${results.confirmation_ms.min}–${results.confirmation_ms.max} ms`);
console.log(`confirmed    ${latencies.length}/${N}${failures.length ? ` (${failures.length} failed)` : ''}`);
console.log(`backoffs     ${throttles.length} (public endpoint throttling, not program failures)`);
console.log(`read back    ${verified.length} receipts decoded and field-matched from the cluster`);

console.log('\n--- cost ---');
console.log(`per receipt  ${perReceiptSol} SOL (${lamports.per_receipt} lamports, rent + fee)`);
console.log(`account size ${accountBytes} bytes, read back from the cluster`);
console.log(`total        ${(totalSpent / 1e9).toFixed(6)} SOL for ${latencies.length} receipts`);

// --- what it costs to run this for real -----------------------------------
// Stated at a reflection rate rather than hidden, because the honest version
// of "receipts are cheap" has to name the rate it is cheap at.
console.log('\n--- cost per user per month ---');
const SOL_USD = Number(arg('sol-usd', 0));
for (const rate of [5, 20, 60]) {
  const sol = perReceiptSol * rate;
  const usd = SOL_USD ? ` ≈ $${(sol * SOL_USD).toFixed(4)}` : '';
  console.log(`${String(rate).padStart(3)} reflections/mo   ${sol.toFixed(6)} SOL${usd}`);
}
if (!SOL_USD) {
  console.log('(pass --sol-usd <price> to convert; no network price is fetched here)');
}
results.cost_per_user_month_sol = Object.fromEntries(
  [5, 20, 60].map((rate) => [rate, perReceiptSol * rate]),
);

const jsonPath = arg('json');
if (jsonPath) {
  await writeFile(resolve(ROOT, jsonPath), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nwrote ${jsonPath}`);
}

if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures.slice(0, 5)) console.log(`  #${f.index}: ${f.error}`);
  process.exit(1);
}
