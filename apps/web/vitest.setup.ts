import { afterEach, vi } from 'vitest';

/**
 * Shared setup.
 *
 * This file runs for every test, including the many that use the node
 * environment and have no DOM. Everything browser-specific is therefore
 * guarded — an unguarded `navigator` reference here takes down the crypto and
 * API suites, which have nothing to do with components.
 */

const hasDom = typeof window !== 'undefined' && typeof navigator !== 'undefined';

if (hasDom) {
  // jsdom implements neither of these, and the recovery kit needs both.
  if (typeof URL.createObjectURL === 'undefined') {
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
  }

  // navigator.clipboard is getter-only in jsdom, so it has to be redefined
  // rather than assigned.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });

  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
