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
  reflect(request: ReflectionRequest): Promise<ReflectionResult>;
}
