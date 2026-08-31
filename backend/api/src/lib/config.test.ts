import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from './config.js';

/**
 * Configuration must fail closed.
 *
 * The dangerous failure is not a crash — it is a boot that silently falls back
 * to a development default in production, so nobody finds out until the secret
 * that was never set turns out to have been guessable all along.
 */

const VALID = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(64),
  S3_ENDPOINT: 'http://localhost:9010',
  S3_BUCKET: 'unsaid-private',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
};

beforeEach(() => resetConfigCache());

describe('required configuration', () => {
  it('starts with a complete environment', () => {
    expect(() => loadConfig({ ...VALID })).not.toThrow();
  });

  it.each(Object.keys(VALID))('refuses to start without %s', (key) => {
    const env = { ...VALID } as Record<string, string>;
    delete env[key];
    // A missing secret must be a startup crash, not an undefined that surfaces
    // in production three weeks later.
    expect(() => loadConfig(env)).toThrow(/Invalid environment configuration/);
  });

  it('names every missing variable at once', () => {
    // Reporting one at a time turns a misconfigured deploy into a guessing game.
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*SESSION_SECRET/);
  });

  it('rejects a malformed storage endpoint rather than trying it', () => {
    expect(() => loadConfig({ ...VALID, S3_ENDPOINT: 'not-a-url' })).toThrow();
  });
});

describe('production hardening', () => {
  const production = { ...VALID, NODE_ENV: 'production' };

  it('refuses a short session secret', () => {
    expect(() => loadConfig({ ...production, SESSION_SECRET: 'x'.repeat(40) })).toThrow(
      /at least 48/,
    );
  });

  it('refuses a real AI provider with no key', () => {
    expect(() => loadConfig({ ...production, AI_PROVIDER: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('accepts a fully configured production environment', () => {
    expect(() =>
      loadConfig({ ...production, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }),
    ).not.toThrow();
  });

  it('marks itself as production so environment-gated controls engage', () => {
    // HSTS, proxy trust and the secret-length floor all key off this.
    expect(loadConfig({ ...production }).isProduction).toBe(true);
  });
});

describe('defaults', () => {
  it('defaults to the stub AI provider, which makes no network call', () => {
    // The safe default: reflection cannot silently start sending content
    // somewhere because a variable was forgotten.
    expect(loadConfig({ ...VALID }).AI_PROVIDER).toBe('echo-stub');
  });

  it('defaults to devnet rather than mainnet', () => {
    expect(loadConfig({ ...VALID }).SOLANA_NETWORK).toBe('devnet');
  });

  it('keeps signed-URL lifetimes short', () => {
    const config = loadConfig({ ...VALID });
    expect(config.UPLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(config.DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });
});
