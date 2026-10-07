import { describe, expect, it, vi } from 'vitest';
import { PhalaReflectionProvider } from './phala.js';

/**
 * Attested reflection.
 *
 * The measurement written to the ledger is the one claim here that a stranger
 * will check, so the tests that matter are the ones where it could go wrong: a
 * digest we cannot parse, a report we cannot reach, an enclave that answers
 * with something other than a measurement. In every one of those the honest
 * result is null — recorded on chain as an unattested access — and never a
 * plausible-looking 32 bytes.
 */

const DIGEST = 'ef8a03c0c5e349310394c0d5865f766f8a1258f1acdb5fcb6ed2ebcd757e5f5a';

function respond(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

/** A fetch that answers the attestation report and the completion separately. */
function fakeFetch(report: unknown, completion: unknown, reportOk = true) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return url.includes('/attestation/report')
      ? respond(report, reportOk)
      : respond(completion);
  }) as unknown as typeof fetch;
}

const completion = {
  model: 'google/gemma-4-31b-it',
  choices: [{ message: { content: 'That sounds like it has been sitting with you.' } }],
};

function provider(fetchImpl: typeof fetch) {
  return new PhalaReflectionProvider('a-key', 'google/gemma-4-31b-it', 'https://example.test/v1', fetchImpl);
}

describe('the measurement it records', () => {
  it('is the workload digest the enclave published, as 32 bytes', async () => {
    const result = await provider(
      fakeFetch({ workload_keyset_digest: `sha256:${DIGEST}` }, completion),
    ).reflect({ content: 'something I have not said' });

    expect(result.attestation).toBe(Buffer.from(DIGEST, 'hex').toString('base64url'));
    expect(Buffer.from(result.attestation as string, 'base64url')).toHaveLength(32);
  });

  it('is null when the report cannot be reached', async () => {
    const result = await provider(fakeFetch({}, completion, false)).reflect({ content: 'hello' });
    expect(result.attestation).toBeNull();
  });

  it('is null when the digest is not a sha256 of the right length', async () => {
    for (const digest of ['sha256:deadbeef', 'sha512:' + DIGEST, DIGEST, '', undefined]) {
      const result = await provider(
        fakeFetch({ workload_keyset_digest: digest }, completion),
      ).reflect({ content: 'hello' });
      expect(result.attestation).toBeNull();
    }
  });

  it('is null rather than throwing when the report is unreadable', async () => {
    const broken = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/attestation/report')) throw new Error('network');
      return respond(completion);
    }) as unknown as typeof fetch;

    // An enclave we could not attest is a fact to record, not a reason to deny
    // someone the reflection they asked for.
    const result = await provider(broken).reflect({ content: 'hello' });
    expect(result.content).toContain('sitting with you');
    expect(result.attestation).toBeNull();
  });

  it('asks for a verified instance rather than any instance serving the model', async () => {
    const fetchImpl = fakeFetch({ workload_keyset_digest: `sha256:${DIGEST}` }, completion);
    await provider(fetchImpl).reflect({ content: 'hello' });

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]: [string]) => String(url).includes('/chat/completions'),
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string).provider).toEqual({
      aci_verified: true,
    });
  });

  it('does not put the prompt in the error when the provider fails', async () => {
    const failing = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/attestation/report')
        ? respond({ workload_keyset_digest: `sha256:${DIGEST}` })
        : respond({ error: 'something about the prompt' }, false),
    ) as unknown as typeof fetch;

    await expect(provider(failing).reflect({ content: 'a secret sentence' })).rejects.toThrow(
      /failed with 500/,
    );
    await expect(provider(failing).reflect({ content: 'a secret sentence' })).rejects.not.toThrow(
      /secret sentence/,
    );
  });
});
