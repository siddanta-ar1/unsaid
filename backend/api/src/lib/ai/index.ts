import { loadConfig } from '../config.js';
import { AnthropicReflectionProvider } from './anthropic.js';
import { StubReflectionProvider } from './stub.js';
import type { ReflectionProvider } from './types.js';

export * from './types.js';
export { detectHighRisk, ECHO_SYSTEM_PROMPT } from './prompt.js';

let cached: ReflectionProvider | undefined;

/** Chosen once at startup from validated config — never per request. */
export function getReflectionProvider(): ReflectionProvider {
  if (cached) return cached;
  const config = loadConfig();

  cached =
    config.AI_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY
      ? new AnthropicReflectionProvider(config.ANTHROPIC_API_KEY, config.AI_MODEL)
      : new StubReflectionProvider();

  return cached;
}
