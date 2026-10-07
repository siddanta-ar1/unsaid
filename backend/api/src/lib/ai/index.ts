import { loadConfig } from '../config.js';
import { AnthropicReflectionProvider } from './anthropic.js';
import { PhalaReflectionProvider } from './phala.js';
import { StubReflectionProvider } from './stub.js';
import type { ReflectionProvider } from './types.js';

export * from './types.js';
export { detectHighRisk, ECHO_SYSTEM_PROMPT } from './prompt.js';

let cached: ReflectionProvider | undefined;

/** Chosen once at startup from validated config — never per request. */
export function getReflectionProvider(): ReflectionProvider {
  if (cached) return cached;
  const config = loadConfig();

  /*
   * Order matters only in that the stub is the floor: a misconfigured provider
   * falls back to the one that cannot leak anything, rather than to the one
   * that can but cannot prove what it did.
   */
  if (config.AI_PROVIDER === 'phala' && config.PHALA_API_KEY) {
    cached = new PhalaReflectionProvider(
      config.PHALA_API_KEY,
      config.PHALA_MODEL,
      config.PHALA_BASE_URL,
    );
  } else if (config.AI_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY) {
    cached = new AnthropicReflectionProvider(config.ANTHROPIC_API_KEY, config.AI_MODEL);
  } else {
    cached = new StubReflectionProvider();
  }

  return cached;
}
