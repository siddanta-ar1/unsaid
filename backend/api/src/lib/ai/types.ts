/**
 * Provider-agnostic reflection interface (§18.4: "use an abstraction layer so
 * the provider can be changed later"). Nothing outside this directory knows
 * which vendor is in use.
 */
export interface ReflectionRequest {
  content: string;
}

export interface ReflectionResult {
  content: string;
  modelVersion: string;
  safetyNotice: 'none' | 'support_resources';
  /**
   * A base64url measurement of the code that produced *this* answer, or null
   * where nothing could prove it.
   *
   * Per result rather than per provider: a measurement describes one execution.
   * A provider that is attested in general but could not produce evidence for a
   * particular call has not attested that call, and recording otherwise would
   * be the exact dishonesty the ledger exists to prevent.
   */
  attestation: string | null;
}

export interface ReflectionProvider {
  readonly name: string;
  reflect(request: ReflectionRequest): Promise<ReflectionResult>;
}
