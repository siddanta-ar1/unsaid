import Anthropic from '@anthropic-ai/sdk';
import { ECHO_SYSTEM_PROMPT, detectHighRisk } from './prompt.js';
import type { ReflectionProvider, ReflectionRequest, ReflectionResult } from './types.js';

/**
 * Claude-backed reflection provider.
 *
 * Privacy notes for this file specifically (§18.4):
 *   - Content is passed to the API and then dropped. It is never logged here,
 *     never persisted by this class, and never retained beyond the call.
 *   - Only `modelVersion` is returned for storage — never the prompt.
 *   - Review the provider's retention and training terms before enabling this
 *     in production; that review is a launch gate, not a code concern.
 */
export class AnthropicReflectionProvider implements ReflectionProvider {
  readonly name = 'anthropic';

  /**
   * A vendor API over TLS proves the connection, not the computation. Until
   * this runs somewhere that can produce a measurement, the honest value is
   * null and the ledger records the access as unattested.
   */
  readonly attestation = null;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async reflect({ content }: ReflectionRequest): Promise<ReflectionResult> {
    // Checked locally first: a support-path response should not depend on the
    // model choosing to produce one.
    const highRisk = detectHighRisk(content);

    const response = await this.client.messages.create({
      model: this.model,
      // Echo is meant to be brief — two or three short paragraphs (§18.1).
      max_tokens: 1024,
      // Reflection is a light task; low effort keeps latency and cost down
      // without hurting quality here.
      output_config: { effort: 'low' },
      system: ECHO_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') {
      return {
        content:
          'I was not able to reflect on that one. Your words are still saved, exactly as you wrote them.',
        modelVersion: this.model,
        safetyNotice: highRisk ? 'support_resources' : 'none',
      };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return {
      content: text,
      modelVersion: this.model,
      safetyNotice: highRisk ? 'support_resources' : 'none',
    };
  }
}
