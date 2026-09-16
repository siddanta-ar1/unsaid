// @vitest-environment jsdom
// Only `components/**` gets a DOM from the root config; this is a page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CapturePage from './page';

/**
 * Capture.
 *
 * Nothing written here has been uploaded yet, which means this screen is the
 * only place the words exist. Letting go must stay a decision the user makes
 * on purpose — never one a mis-tap makes for them.
 */

// Hoisted: vi.mock factories run before module-level consts are initialised.
const { push, saveTextThought } = vi.hoisted(() => ({
  push: vi.fn(),
  saveTextThought: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/vault', () => ({
  VaultProvider: ({ children }: { children: React.ReactNode }) => children,
  useVault: () => ({
    isUnlocked: true,
    userId: 'vault-1',
    token: 'token',
    key: {},
    keyVersion: 1,
    pendingRecoveryCode: null,
  }),
}));

vi.mock('@/lib/signals', () => ({ track: vi.fn(), trackReturn: vi.fn(), sendFeedback: vi.fn() }));
vi.mock('@/lib/thoughts', () => ({ saveTextThought, saveAudioThought: vi.fn() }));

const THOUGHT = 'the thing I have not said to anyone';

async function writeAndReachTheDecision() {
  render(<CapturePage />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/say anything/i), THOUGHT);
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  return user;
}

beforeEach(() => {
  push.mockClear();
  saveTextThought.mockReset().mockResolvedValue({ id: 'saved-id' });
});

describe('letting a thought go', () => {
  it('does not discard it the instant the button is pressed', async () => {
    const user = await writeAndReachTheDecision();
    await user.click(screen.getByRole('button', { name: /let it go/i }));

    expect(screen.getByRole('heading', { name: /let go/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bring it back/i })).toBeInTheDocument();
    // Still here: nothing has navigated away yet.
    expect(push).not.toHaveBeenCalled();
  });

  it('gives the words back intact when the release was a mistake', async () => {
    const user = await writeAndReachTheDecision();
    await user.click(screen.getByRole('button', { name: /let it go/i }));
    await user.click(screen.getByRole('button', { name: /bring it back/i }));

    expect(screen.getByRole('heading', { name: /what do you want to do/i })).toBeInTheDocument();

    // The proof that nothing was lost: it can still be saved, unchanged.
    await user.click(screen.getByRole('button', { name: /keep it privately/i }));
    expect(saveTextThought).toHaveBeenCalledWith(THOUGHT, expect.anything());
  });

  it('leaves without saving once the release is confirmed', async () => {
    const user = await writeAndReachTheDecision();
    await user.click(screen.getByRole('button', { name: /let it go/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    expect(push).toHaveBeenCalledWith('/app');
    expect(saveTextThought).not.toHaveBeenCalled();
  });
});
