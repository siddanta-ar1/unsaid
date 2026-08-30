import { detectHighRisk } from './prompt.js';
import type { ReflectionProvider, ReflectionRequest, ReflectionResult } from './types.js';

/**
 * The default provider in development. It never makes a network call, which
 * means the whole Echo flow — consent gate, encryption of the response, safety
 * routing — can be built and tested before any content has ever left a machine.
 */
export class StubReflectionProvider implements ReflectionProvider {
  readonly name = 'echo-stub';

  async reflect({ content }: ReflectionRequest): Promise<ReflectionResult> {
    const highRisk = detectHighRisk(content);
    const words = content.trim().split(/\s+/).length;

    return {
      content: highRisk
        ? 'It sounds like you are carrying something very heavy right now. You do not have to hold it alone — please consider reaching out to someone you trust, or a local crisis line. I am glad you wrote it down.'
        : `I hear you. You gave this about ${words} words, which suggests it had been sitting with you for a while.\n\nWhat part of it feels most unresolved right now?`,
      modelVersion: 'echo-stub-v1',
      safetyNotice: highRisk ? 'support_resources' : 'none',
    };
  }
}
