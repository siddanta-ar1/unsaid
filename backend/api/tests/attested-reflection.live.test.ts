import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PhalaReflectionProvider } from '../src/lib/ai/phala.js';
import { hashReflection, recordAccess, deriveSubject } from '../src/lib/consent-ledger.js';
import { getDatabase } from '../src/db/client.js';
import { consentReceipts, thoughts, users } from '../src/db/schema.js';
import { loadConfig } from '../src/lib/config.js';

/**
 * The whole claim, end to end, against things that cost money and can be down.
 *
 * Everything else in this suite runs offline. This one sends a real sentence to
 * a real enclave, takes the measurement the hardware published, writes it to
 * devnet, and reads it back — which is the only way to know that the chain of
 * "which code read my memory" actually holds from the prompt to the ledger.
 *
 * Gated on LIVE_ATTESTATION=1 so a normal `pnpm test` never spends credit or
 * fails because a third party is having a bad afternoon:
 *
 *   LIVE_ATTESTATION=1 pnpm --filter @unsaid/api test attested-reflection
 */
const live = process.env.LIVE_ATTESTATION === '1' && Boolean(process.env.PHALA_API_KEY);

let userId: string | null = null;
let thoughtId: string | null = null;

afterAll(async () => {
  const db = getDatabase();
  if (thoughtId) await db.delete(thoughts).where(eq(thoughts.id, thoughtId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

describe.skipIf(!live)('a reflection that can prove what ran', () => {
  it('records the enclave measurement the report publishes', async () => {
    const config = loadConfig();
    const provider = new PhalaReflectionProvider(
      config.PHALA_API_KEY as string,
      config.PHALA_MODEL,
      config.PHALA_BASE_URL,
    );

    const result = await provider.reflect({
      content: 'I keep rewriting the same message and never sending it.',
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.attestation).not.toBeNull();

    // The measurement must be the one anyone else can read, not one we chose.
    const report = await (
      await fetch(
        `${config.PHALA_BASE_URL}/attestation/report?model=${encodeURIComponent(config.PHALA_MODEL)}`,
      )
    ).json();
    const published = Buffer.from(
      (report.workload_keyset_digest as string).slice('sha256:'.length),
      'hex',
    ).toString('base64url');

    expect(result.attestation).toBe(published);
    expect(Buffer.from(result.attestation as string, 'base64url')).toHaveLength(32);
  }, 120_000);

  it('puts that measurement on chain as an attested access', async () => {
    const { buildApp } = await import('../src/app.js');
    const { createVault, sealText } = await import('@unsaid/crypto');
    const db = getDatabase();
    const config = loadConfig();

    const app = (await buildApp()) as never as {
      inject: (options: Record<string, unknown>) => Promise<{ json: () => never; statusCode: number }>;
      ready: () => Promise<void>;
      close: () => Promise<void>;
    };
    await app.ready();

    try {
      const vault = await createVault('a passphrase for the live attestation check');
      const created = await app.inject({
        method: 'POST',
        url: '/v1/identity/guest',
        payload: {
          passphrase: vault.passphrase,
          recovery: vault.recovery,
          loginProof: vault.loginProof,
        },
      });
      const { token, userId: id } = created.json() as never as { token: string; userId: string };
      userId = id;
      const auth = { authorization: `Bearer ${token}` };

      await app.inject({
        method: 'POST',
        url: '/v1/consents',
        headers: auth,
        payload: { scope: 'ai_reflection_once', version: 1, granted: true },
      });

      const sealed = await sealText('I keep rewriting the same message.', vault.vaultKey, 1);
      const intent = await app.inject({
        method: 'POST',
        url: '/v1/thoughts/intents',
        headers: auth,
        payload: {
          type: 'text',
          byteSize: sealed.ciphertext.byteLength,
          contentHash: sealed.contentHash,
        },
      });
      const { uploadUrl, intentId } = intent.json() as never as {
        uploadUrl: string;
        intentId: string;
      };
      await fetch(uploadUrl, {
        method: 'PUT',
        body: sealed.ciphertext as never as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      });
      const registered = await app.inject({
        method: 'POST',
        url: '/v1/thoughts',
        headers: auth,
        payload: { intentId, wrappedKey: sealed.wrappedKey, header: sealed.header },
      });
      thoughtId = (registered.json() as never as { thought: { id: string } }).thought.id;

      // The real route, with the real provider: this is the path a user takes.
      const reflected = await app.inject({
        method: 'POST',
        url: `/v1/thoughts/${thoughtId}/reflect`,
        headers: auth,
        payload: { consentVersion: 1, content: 'Something I have not said out loud.' },
      });
      expect(reflected.statusCode).toBe(200);

      let row: typeof consentReceipts.$inferSelect | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        [row] = await db
          .select()
          .from(consentReceipts)
          .where(eq(consentReceipts.thoughtId, thoughtId as string));
        if (row?.status === 'confirmed' || row?.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      expect(row?.status).toBe('confirmed');
      expect(row?.purpose).toBe('reflection');
      expect(row?.attestation).toBeTruthy();
      expect(row?.txSignature).toBeTruthy();

      // And read it back from the chain, which is the only copy that counts.
      const { createSolanaRpc, address } = await import('@solana/kit');
      const { decodeConsentReceipt } = await import('@unsaid/solana');
      const rpc = createSolanaRpc(config.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
      const { value } = await rpc
        .getAccountInfo(address(row?.accountAddress as string), { encoding: 'base64' })
        .send();
      expect(value).not.toBeNull();

      const onChain = decodeConsentReceipt(Buffer.from(value!.data[0], 'base64'));
      expect(Buffer.from(onChain.attestation).toString('base64url')).toBe(row?.attestation);
      expect(onChain.purpose).toBe(0);
      expect(Buffer.from(onChain.subject).toString('base64url')).toBe(
        Buffer.from(deriveSubject(userId as string)).toString('base64url'),
      );

      console.log('\n  attested receipt:', row?.accountAddress);
      console.log('  measurement     :', row?.attestation);
      console.log('  signature       :', row?.txSignature);
    } finally {
      await app.close();
    }
  }, 240_000);
});
