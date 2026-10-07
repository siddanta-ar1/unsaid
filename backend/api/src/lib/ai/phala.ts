import { detectHighRisk, ECHO_SYSTEM_PROMPT } from './prompt.js';
import type { ReflectionProvider, ReflectionRequest, ReflectionResult } from './types.js';

/**
 * Reflection inside a hardware enclave, with evidence of what ran.
 *
 * Every other provider here asks the user to take our word for what happened to
 * their memory once it left the device. This one does not: the gateway runs in
 * an Intel TDX enclave whose attestation report is published at a public URL,
 * and the measurement that report carries is what we write to the consent
 * ledger. Anyone can fetch the same report, compare the digest to the one on
 * chain, and follow the evidence to the TDX quote and to the git commit of the
 * gateway's source.
 *
 * What this does not claim: the memory is plaintext inside the enclave, because
 * a language model cannot read what it cannot read. What changes is that nobody
 * outside the chip can see it and the hardware signs a statement of which code
 * was loaded. The remaining trust is in Intel and NVIDIA rather than in us,
 * which is a smaller and more checkable thing than "read our privacy policy".
 */

interface AttestationReport {
  /** "sha256:<64 hex>" — the measurement of the workload serving this model. */
  workload_keyset_digest?: string;
  attestation?: { tee_type?: string };
}

/** Milliseconds a fetched measurement is reused before being read again. */
const ATTESTATION_TTL_MS = 10 * 60_000;

export class PhalaReflectionProvider implements ReflectionProvider {
  readonly name = 'phala';

  private cached: { value: string; at: number } | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://inference.phala.com/v1',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async reflect({ content }: ReflectionRequest): Promise<ReflectionResult> {
    const highRisk = detectHighRisk(content);

    /*
     * The measurement is read before the call rather than after. If the enclave
     * cannot be attested right now, the access is still recorded — as an
     * unattested one, which the program on chain enforces as a distinct kind of
     * event. Failing to measure must never become silently indistinguishable
     * from measuring.
     */
    const attestation = await this.measurement();

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        // Routes to a verified confidential instance rather than any instance
        // that happens to serve the model.
        provider: { aci_verified: true },
        max_tokens: 400,
        messages: [
          { role: 'system', content: ECHO_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    });

    if (!response.ok) {
      // Deliberately without the body: a provider error can quote the prompt
      // that caused it, and the prompt is the one thing that must not be logged.
      throw new Error(`Phala inference failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Phala inference returned no content.');

    return {
      content: text,
      modelVersion: payload.model ?? this.model,
      safetyNotice: highRisk ? 'support_resources' : 'none',
      attestation,
    };
  }

  /**
   * The workload measurement, as 32 bytes in base64url.
   *
   * Returns null rather than throwing: an enclave we could not attest is a fact
   * to record, not a reason to deny someone the reflection they asked for.
   */
  private async measurement(): Promise<string | null> {
    if (this.cached && Date.now() - this.cached.at < ATTESTATION_TTL_MS) {
      return this.cached.value;
    }

    try {
      const url = `${this.baseUrl}/attestation/report?model=${encodeURIComponent(this.model)}`;
      const response = await this.fetchImpl(url);
      if (!response.ok) return null;

      const report = (await response.json()) as AttestationReport;
      const digest = report.workload_keyset_digest;
      if (!digest?.startsWith('sha256:')) return null;

      const hex = digest.slice('sha256:'.length);
      // The on-chain field is exactly 32 bytes. A digest of any other length is
      // not a measurement we understand, and guessing at it would put a number
      // on the ledger that means nothing.
      if (!/^[0-9a-f]{64}$/i.test(hex)) return null;

      const value = Buffer.from(hex, 'hex').toString('base64url');
      this.cached = { value, at: Date.now() };
      return value;
    } catch {
      return null;
    }
  }
}
