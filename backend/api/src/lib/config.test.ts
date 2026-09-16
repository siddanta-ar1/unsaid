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
  const production = {
    ...VALID,
    NODE_ENV: 'production',
    // Deliberately not the dev fixture's localhost: pointing production at a
    // developer's machine is itself one of the failures under test below.
    DATABASE_URL: 'postgres://user:pass@db.internal.net:5432/unsaid',
    S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  };

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

  it('refuses the placeholder shipped in .env.example', () => {
    // 51 characters, so the length floor alone waves it straight through — and
    // a published signing secret forges every session there is.
    const placeholder = 'dev_only_secret_replace_me_with_48_bytes_of_entropy';
    expect(placeholder.length).toBeGreaterThanOrEqual(48);
    expect(() => loadConfig({ ...production, SESSION_SECRET: placeholder })).toThrow(
      /placeholder/i,
    );
  });

  it('refuses a database still pointed at the developer machine', () => {
    expect(() =>
      loadConfig({ ...production, DATABASE_URL: 'postgres://u:p@localhost:54332/unsaid' }),
    ).toThrow(/localhost/i);
  });

  it('refuses storage still pointed at MinIO', () => {
    expect(() => loadConfig({ ...production, S3_ENDPOINT: 'http://127.0.0.1:9010' })).toThrow(
      /localhost/i,
    );
  });

  it('leaves development alone, so local setup stays frictionless', () => {
    expect(() =>
      loadConfig({
        ...VALID,
        NODE_ENV: 'development',
        SESSION_SECRET: 'dev_only_secret_replace_me_with_48_bytes_of_entropy',
      }),
    ).not.toThrow();
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
