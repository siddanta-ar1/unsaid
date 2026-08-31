import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecoveryKit } from './RecoveryKit';

/**
 * The recovery kit screen.
 *
 * This is the one screen in the product whose failure is unrecoverable. If a
 * user gets past it without saving the kit and later forgets their phrase,
 * every memory they wrote is gone permanently — and nobody, including us, can
 * undo that. So the tests here are about the gate, not the layout.
 */

const VAULT_ID = '11111111-2222-3333-4444-555555555555';
const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789';

function renderKit(onAcknowledged = vi.fn()) {
  render(<RecoveryKit vaultId={VAULT_ID} recoveryCode={CODE} onAcknowledged={onAcknowledged} />);
  return { onAcknowledged, user: userEvent.setup() };
}

describe('the gate', () => {
  it('cannot be dismissed before the kit is saved', async () => {
    renderKit();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('stays closed after only ticking the box', async () => {
    const { user } = renderKit();
    await user.click(screen.getByRole('checkbox'));
    // Acknowledging the risk is not the same as having the kit.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('stays closed after only downloading', async () => {
    const { user } = renderKit();
    await user.click(screen.getByRole('button', { name: /download it/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('opens only once the kit is saved and the risk acknowledged', async () => {
    const { user, onAcknowledged } = renderKit();

    await user.click(screen.getByRole('button', { name: /download it/i }));
    await user.click(screen.getByRole('checkbox'));

    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeEnabled();

    await user.click(cont);
    expect(onAcknowledged).toHaveBeenCalledOnce();
  });

  it('accepts copying as saving', async () => {
    const { user } = renderKit();

    await user.click(screen.getByRole('button', { name: /copy it/i }));
    await user.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});

describe('what it shows', () => {
  it('shows both halves a person needs to get back in', () => {
    renderKit();
    // Without the vault id, the code alone opens nothing.
    expect(screen.getByText(new RegExp(VAULT_ID))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(CODE))).toBeInTheDocument();
  });

  it('states plainly that we cannot reissue it', () => {
    renderKit();
    expect(screen.getByText(/cannot email it to you, reset it, or recover/i)).toBeInTheDocument();
  });

  it('spells out the consequence next to the confirmation', () => {
    renderKit();
    expect(screen.getByText(/stays locked forever/i)).toBeInTheDocument();
  });

  it('warns that the screen cannot be shown again', () => {
    renderKit();
    expect(screen.getByText(/cannot be shown again/i)).toBeInTheDocument();
  });
});

describe('when the browser blocks the clipboard', () => {
  it('explains the alternative rather than failing silently', async () => {
    const { user } = renderKit();
    // userEvent.setup() installs its own clipboard stub, so the failure has to
    // be injected after it rather than before.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });

    await user.click(screen.getByRole('button', { name: /copy it/i }));

    expect(screen.getByText(/blocked the clipboard/i)).toBeInTheDocument();
    // A failed copy must not count as saved.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});
