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
}

export interface ReflectionProvider {
  readonly name: string;
  /**
   * A base64url measurement of the code that ran, where the provider can prove
   * one, and null where it cannot.
   *
   * Null is not a gap to be filled in later — it is the honest answer for every
   * provider that runs on hardware we cannot attest, and it is recorded on the
   * ledger as its own kind of access rather than quietly omitted from an
   * ordinary one.
   */
  readonly attestation: string | null;
  reflect(request: ReflectionRequest): Promise<ReflectionResult>;
}
