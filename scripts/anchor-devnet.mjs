#!/usr/bin/env node
/**
 * Anchors one memory on a live cluster, reads it back, and prints what it cost.
 *
 * The program has been deployed since 17 Sep 2026, but nothing had ever called
 * it: the instruction layout, the PDA derivation and the client's Borsh
 * encoding were covered only by unit tests, which agree with themselves by
 * construction. This runs the real path against a validator.
 *
 * It is also the benchmark harness for the on-chain half of the paper — cost
 * and confirmation time per receipt are printed because they are the numbers
 * that decide whether per-access receipts are affordable at all.
 *
 * Usage:
 *   node scripts/anchor-devnet.mjs [--thought-id <uuid>] [--hash <base64url>]
 *
 * With no arguments it invents a memory id and a ciphertext hash, which is the
 * right default: this anchors a *commitment*, and the commitment reveals
 * nothing, so there is no reason to involve a real memory.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// Relative specifiers resolve against this file, not the working directory, and
// this script is run from the repo root as often as from anywhere else.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = (p) => pathToFileURL(resolve(ROOT, p)).href;

const KIT = from('apps/web/node_modules/@solana/kit/dist/index.node.mjs');
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
} = await import(KIT);

const { computeCommitment, deriveThoughtSeed, fromBase64Url, toBase64Url } = await import(
  from('packages/crypto/dist/index.js'),
);
const { createRecordInstruction, decodeThoughtRecord, deriveRecordAddress, UNSAID_PROGRAM_ID } =
  await import(from('packages/solana/dist/index.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const RPC_URL = arg('rpc', 'https://api.devnet.solana.com');
const WS_URL = RPC_URL.replace(/^http/, 'ws');
const PROGRAM_ID = arg('program', process.env.SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID);
const thoughtId = arg('thought-id', randomUUID());
const contentHash = arg('hash', toBase64Url(new Uint8Array(randomBytes(32))));

const keypairPath = arg('keypair', join(homedir(), '.config', 'solana', 'id.json'));
const secret = Uint8Array.from(JSON.parse(await readFile(keypairPath, 'utf8')));
const signer = await createKeyPairSignerFromBytes(secret);

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

console.log('cluster      ', RPC_URL);
console.log('program      ', PROGRAM_ID);
console.log('owner        ', signer.address);
console.log('memory id    ', thoughtId);
console.log('ciphertext#  ', contentHash);

// The commitment is what the server would have derived from the ciphertext
// hash it already holds, so a client cannot anchor an arbitrary value.
const commitment = await computeCommitment(contentHash, thoughtId);
const seed = fromBase64Url(await deriveThoughtSeed(thoughtId));
const [record] = await deriveRecordAddress(signer.address, seed, address(PROGRAM_ID));

console.log('commitment   ', commitment);
console.log('record PDA   ', record);

const before = (await rpc.getBalance(signer.address).send()).value;

const instruction = await createRecordInstruction({
  owner: signer.address,
  thoughtSeed: seed,
  commitment: fromBase64Url(commitment),
  programAddress: address(PROGRAM_ID),
});

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  (m) => appendTransactionMessageInstruction(instruction, m),
);

const signed = await signTransactionMessageWithSigners(message);
const signature = getSignatureFromTransaction(signed);

const startedAt = Date.now();
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
  commitment: 'confirmed',
});
const confirmedMs = Date.now() - startedAt;

const after = (await rpc.getBalance(signer.address).send()).value;

console.log('\n--- anchored ---');
console.log('signature    ', signature);
console.log('confirmed in ', `${confirmedMs} ms`);
console.log('cost         ', `${Number(before - after) / 1e9} SOL (rent + fee)`);

// Reading it back is the part that proves the encoding: if the discriminator,
// the field order or the Borsh layout were wrong, this decode is where it shows.
const { value: account } = await rpc.getAccountInfo(record, { encoding: 'base64' }).send();
if (!account) throw new Error('The record was confirmed but could not be read back.');

const decoded = decodeThoughtRecord(Buffer.from(account.data[0], 'base64'));
const roundTripped = toBase64Url(decoded.commitment) === commitment;

console.log('\n--- read back from chain ---');
console.log('owner        ', decoded.owner);
console.log('commitment   ', toBase64Url(decoded.commitment));
console.log('matches      ', roundTripped ? 'yes' : 'NO — the encoding is wrong');
console.log('version      ', decoded.version);
console.log('status       ', decoded.status === 0 ? 'active' : `status ${decoded.status}`);
console.log('access mode  ', decoded.accessMode);
console.log('created at   ', new Date(Number(decoded.createdAt) * 1000).toISOString());
console.log('account size ', account.data ? Buffer.from(account.data[0], 'base64').length : 0, 'bytes');
console.log('rent         ', `${Number(account.lamports) / 1e9} SOL`);

const cluster = RPC_URL.includes('devnet') ? '?cluster=devnet' : '';
console.log('\nexplorer     ', `https://explorer.solana.com/tx/${signature}${cluster}`);
console.log(
  'verify       ',
  `/verify?owner=${signer.address}&id=${thoughtId}&hash=${encodeURIComponent(contentHash)}`,
);

if (!roundTripped) process.exit(1);
