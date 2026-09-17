import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessLog } from './AccessLog';
import type { ActivityItem, ActivityResponse, ChainCheck } from '@/lib/activity';
import { VaultProvider } from '@/lib/vault';

/**
 * What the access log shows.
 *
 * The logic that catches a disagreement is tested in `lib/activity.test.ts`.
 * What matters here is that the disagreement reaches the screen: a log that
 * detected a mismatch and rendered it as a quiet grey line would be worse than
 * one that never checked.
 */

const item: ActivityItem = {
  thoughtId: '11111111-1111-4111-8111-111111111111',
  receiptId: 'cmVjZWlwdA',
  purpose: 'reflection_unattested',
  consentVersion: 1,
  attestation: null,
  resultHash: 'aGFzaA',
  network: 'devnet',
  programId: '7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ',
  accountAddress: null,
  signature: 'sig',
  status: 'confirmed',
  at: new Date('2026-09-17T08:00:00Z').toISOString(),
};

beforeEach(() => {
  // The log needs a session before it will ask for anything. The provider
  // restores one from sessionStorage after mount, which is the same path a
  // returning tab takes.
  sessionStorage.setItem('unsaid.session', 'a-session-token');
  sessionStorage.setItem('unsaid.user', '22222222-2222-4222-8222-222222222222');
});

function renderLog(items: ActivityItem[], check?: (s: string, i: ActivityItem) => Promise<ChainCheck>) {
  const load = vi.fn(
    async (): Promise<ActivityResponse> => ({ subject: 'c3ViamVjdA', items }),
  );
  render(
    <VaultProvider>
      <AccessLog load={load} check={check ?? (async () => ({ state: 'unpublished' }))} />
    </VaultProvider>,
  );
  return userEvent.setup();
}

describe('the empty state', () => {
  it('reads as the good outcome, not as a missing feature', async () => {
    renderLog([]);
    expect(await screen.findByText('Nothing has ever opened a memory.')).toBeInTheDocument();
  });
});

describe('a row', () => {
  it('says when nothing could prove what ran', async () => {
    renderLog([item]);
    expect(await screen.findByText('No proof of what ran')).toBeInTheDocument();
  });

  it('distinguishes an attested access from an unattested one', async () => {
    renderLog([{ ...item, purpose: 'reflection', attestation: 'bWVhc3VyZQ' }]);
    expect(await screen.findByText('Attested')).toBeInTheDocument();
    expect(screen.queryByText('No proof of what ran')).not.toBeInTheDocument();
  });

  it('shows a receipt we failed to publish rather than dropping it', async () => {
    renderLog([{ ...item, status: 'pending', signature: null }]);
    expect(await screen.findByText('Not published')).toBeInTheDocument();
  });

  it('names the version of the wording that was agreed to', async () => {
    renderLog([{ ...item, consentVersion: 3 }]);
    expect(await screen.findByText('Consent v3')).toBeInTheDocument();
  });

  it('never renders anything that could carry content', async () => {
    renderLog([item]);
    await screen.findByText('No proof of what ran');
    // The memory is reachable by link, but nothing about what it says is here.
    expect(document.body.textContent).not.toContain(item.resultHash);
    expect(document.body.textContent).not.toContain(item.thoughtId);
  });
});

describe('checking against the chain', () => {
  it('reports a match in the row that was checked', async () => {
    const user = renderLog([item], async () => ({
      state: 'matches',
      recordAddress: 'FoirbW8UthjqRDAkNaXeNZEwEP4iNhqmWeMrn9V9w231',
      recordedAt: new Date('2026-09-17T08:00:05Z'),
    }));
    await user.click(await screen.findByRole('button', { name: 'Check the chain' }));
    expect(await screen.findByText(/Matches the chain/)).toBeInTheDocument();
  });

  it('says plainly when the chain has no record of what we claimed', async () => {
    const user = renderLog([item], async () => ({ state: 'missing', recordAddress: 'x' }));
    await user.click(await screen.findByRole('button', { name: 'Check the chain' }));
    expect(
      await screen.findByText('We said this was published, and the chain has no record of it.'),
    ).toBeInTheDocument();
  });

  it('names the fields the chain disagrees with us about', async () => {
    const user = renderLog([item], async () => ({
      state: 'differs',
      recordAddress: 'x',
      fields: ['purpose', 'attestation'],
    }));
    await user.click(await screen.findByRole('button', { name: 'Check the chain' }));
    expect(
      await screen.findByText('The chain disagrees with us about the purpose, attestation.'),
    ).toBeInTheDocument();
  });
});
