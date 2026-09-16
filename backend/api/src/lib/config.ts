import { z } from 'zod';

/**
 * The single place `process.env` is read (§20.2). Everything else imports the
 * parsed object, so a missing secret is a startup crash rather than an
 * undefined that surfaces in production three weeks later.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3011),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  /** Signs session tokens. Must be >=32 bytes of real entropy in production. */
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(720),

  // S3-compatible storage: MinIO locally, Cloudflare R2 in production.
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  CORS_ORIGIN: z.string().default('http://localhost:3010'),

  // Echo. Absent means reflection is disabled rather than silently degraded.
  AI_PROVIDER: z.enum(['anthropic', 'echo-stub']).default('echo-stub'),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Matches .env.example, which said opus-5 while this default said sonnet-5 —
  // the two disagreeing meant a deploy without AI_MODEL set would quietly run
  // a different model from the one documented.
  AI_MODEL: z.string().default('claude-opus-5'),

  /**
   * Reflections allowed per user per rolling week.
   *
   * Echo is the only unbounded cost in the system and the only path that sends
   * content to a third party, so it needs a budget rather than a burst limit —
   * the hourly rate limit still permits well over a thousand calls a week.
   * Sized to be invisible to genuine use.
   */
  ECHO_WEEKLY_QUOTA: z.coerce.number().int().min(1).max(1000).default(50),

  SOLANA_NETWORK: z.enum(['devnet', 'mainnet-beta']).default('devnet'),
  SOLANA_RPC_URL: z.string().optional(),
  SOLANA_PROGRAM_ID: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema> & { isProduction: boolean };

/** The vocabulary .env.example and the secret scanner both use for fillers. */
const PLACEHOLDER = /dev[_-]?only|replace[_-]?me|change[_-]?me|placeholder|example|your[_-]?secret/i;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  const config = { ...parsed.data, isProduction: parsed.data.NODE_ENV === 'production' };

  if (config.isProduction) {
    if (config.AI_PROVIDER !== 'echo-stub' && !config.ANTHROPIC_API_KEY) {
      throw new Error('AI_PROVIDER is set to a real provider but ANTHROPIC_API_KEY is missing.');
    }
    if (config.SESSION_SECRET.length < 48) {
      throw new Error('SESSION_SECRET must be at least 48 characters in production.');
    }
    // The placeholder in .env.example is 51 characters, so length alone waves
    // it through. A published signing secret forges every session there is,
    // and it fails silently because the app starts perfectly well with it.
    if (PLACEHOLDER.test(config.SESSION_SECRET)) {
      throw new Error(
        'SESSION_SECRET is still a development placeholder. ' +
          'Generate a real one with `openssl rand -base64 48`.',
      );
    }
    for (const [name, value] of [
      ['DATABASE_URL', config.DATABASE_URL],
      ['S3_ENDPOINT', config.S3_ENDPOINT],
    ] as const) {
      if (/localhost|127\.0\.0\.1/.test(value)) {
        throw new Error(`${name} still points at localhost in production.`);
      }
    }
  }

  cached = config;
  return config;
}

/** Test-only: clears the memoised config so a suite can vary the environment. */
export function resetConfigCache(): void {
  cached = undefined;
}
