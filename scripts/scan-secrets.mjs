#!/usr/bin/env node
/**
 * Blocks secrets from entering git history.
 *
 * Why this exists: `.gitignore` is a convention with no enforcement. A pattern
 * that silently fails to match — or a secret committed under an unexpected
 * name — leaves no trace until the push has already happened, and on a public
 * repository that is unrecoverable. This inspects staged *content*, so a
 * renamed or relocated secret is still caught.
 *
 *   node scripts/scan-secrets.mjs           scan staged changes (pre-commit)
 *   node scripts/scan-secrets.mjs --all     scan the whole tracked tree (CI)
 */

import { execFileSync } from 'node:child_process';

const RULES = [
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'Slack token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Stripe secret key', pattern: /sk_live_[A-Za-z0-9]{20,}/ },
  {
    name: 'Solana keypair array',
    // A 64-byte secret key serialised as a JSON number array.
    pattern: /\[\s*(?:\d{1,3}\s*,\s*){63,}\d{1,3}\s*\]/,
  },
  {
    name: 'Assigned secret literal',
    // KEY=value or "key": "value" where the name says secret and the value is
    // long enough to be real. Short placeholders fall below the threshold.
    pattern:
      /(?:secret|password|passwd|token|api[_-]?key|private[_-]?key)["'\s]*[:=]\s*["'][^"'\s]{24,}["']/i,
  },
];

/** Files whose whole purpose is to show the shape of configuration. */
const ALLOWLISTED_PATHS = [/^\.env\.example$/, /^scripts\/scan-secrets\.mjs$/];

/** Lines that are demonstrably not a live credential. */
const ALLOWLISTED_LINES = [
  /dev_only/i,
  /replace[_-]?me/i,
  /your[_-]?(api[_-]?key|secret|token)/i,
  /example|placeholder|dummy|sample|redacted/i,
  /unsaid_local_dev/,
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const scanAll = process.argv.includes('--all');

const files = git(scanAll ? ['ls-files'] : ['diff', '--cached', '--name-only', '--diff-filter=ACM'])
  .split('\n')
  .filter(Boolean)
  .filter((file) => !ALLOWLISTED_PATHS.some((allowed) => allowed.test(file)));

const findings = [];

for (const file of files) {
  let content;
  try {
    // Read the staged blob, not the working copy: those can differ, and it is
    // the staged bytes that would actually be committed.
    content = scanAll ? git(['show', `HEAD:${file}`]) : git(['show', `:${file}`]);
  } catch {
    continue; // Binary, deleted, or unreadable — nothing to scan.
  }
  if (content.includes('\u0000')) continue; // Binary, not text.

  content.split('\n').forEach((line, index) => {
    if (ALLOWLISTED_LINES.some((allowed) => allowed.test(line))) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file, line: index + 1, rule: rule.name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('\nSecret scan FAILED - refusing to let this into git history.\n');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.rule}`);
  }
  console.error(
    '\nThe matched value is deliberately not printed. Remove it, rotate the\n' +
      'credential if it was ever real, and commit again. If this is a false\n' +
      'positive, add the file to ALLOWLISTED_PATHS with a reason.\n',
  );
  process.exit(1);
}

console.log(`Secret scan clean (${files.length} file${files.length === 1 ? '' : 's'}).`);
