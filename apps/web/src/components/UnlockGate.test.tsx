import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnlockGate } from './UnlockGate';
import { VaultProvider } from '@/lib/vault';

/**
 * The unlock gate.
 *
 * Two things matter here. The recovery path must always be reachable — someone
 * who has forgotten their phrase is at their least patient and least likely to
 * go hunting for it. And the passphrase must never leave this component: it is
 * used to derive a key and then discarded.
 */

function renderGate() {
  render(
    <VaultProvider>
      <UnlockGate>
        <p>vault contents</p>
      </UnlockGate>
    </VaultProvider>,
  );
  return userEvent.setup();
}

describe('what it shows first', () => {
  it('keeps the vault hidden until unlocked', () => {
    renderGate();
    expect(screen.queryByText('vault contents')).not.toBeInTheDocument();
  });

  it('offers to create a vault when the browser has never seen one', () => {
    renderGate();
    expect(screen.getByRole('heading', { name: /choose a phrase/i })).toBeInTheDocument();
  });

  it('explains that the phrase cannot be reset before asking for one', () => {
    renderGate();
    expect(screen.getByText(/cannot see it or reset it/i)).toBeInTheDocument();
    // And promises the way back, so the warning does not read as a dead end.
    expect(screen.getByText(/recovery kit next/i)).toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('is reachable from the first screen', async () => {
    const user = renderGate();
    // Someone who has forgotten their phrase should not have to hunt for this.
    await user.click(screen.getByRole('button', { name: /i lost my phrase/i }));
    expect(screen.getByRole('heading', { name: /use your recovery kit/i })).toBeInTheDocument();
  });

  it('asks for both halves of the kit', async () => {
    const user = renderGate();
    await user.click(screen.getByRole('button', { name: /i lost my phrase/i }));

    expect(screen.getByPlaceholderText(/vault id/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/recovery code/i)).toBeInTheDocument();
    // And a new phrase, so nobody is left depending on a piece of paper.
    expect(screen.getByPlaceholderText(/choose a new phrase/i)).toBeInTheDocument();
  });

  it('says memories are untouched, since that is the fear', async () => {
    const user = renderGate();
    await user.click(screen.getByRole('button', { name: /i lost my phrase/i }));
    expect(screen.getByText(/memories are untouched/i)).toBeInTheDocument();
  });

  it('can be left again', async () => {
    const user = renderGate();
    await user.click(screen.getByRole('button', { name: /i lost my phrase/i }));
    await user.click(screen.getByRole('button', { name: /remember my phrase/i }));
    expect(screen.getByRole('heading', { name: /unlock your vault/i })).toBeInTheDocument();
  });
});

describe('the passphrase field', () => {
  it('refuses a phrase short enough to guess', async () => {
    const user = renderGate();
    await user.type(screen.getByPlaceholderText(/a phrase you will remember/i), 'short');
    expect(screen.getByRole('button', { name: /create my vault/i })).toBeDisabled();
  });

  it('accepts one long enough', async () => {
    const user = renderGate();
    await user.type(
      screen.getByPlaceholderText(/a phrase you will remember/i),
      'the quiet hour before sleep',
    );
    expect(screen.getByRole('button', { name: /create my vault/i })).toBeEnabled();
  });

  it('is masked, so a shoulder does not read it', () => {
    renderGate();
    expect(screen.getByPlaceholderText(/a phrase you will remember/i)).toHaveAttribute(
      'type',
      'password',
    );
  });
});

describe('when unlocking fails', () => {
  it('says so without hinting at what was wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );
    const user = renderGate();

    await user.click(screen.getByRole('button', { name: /i lost my phrase/i }));
    await user.type(
      screen.getByPlaceholderText(/vault id/i),
      '11111111-2222-3333-4444-555555555555',
    );
    await user.type(screen.getByPlaceholderText(/recovery code/i), 'ABCD-EFGH');
    await user.type(screen.getByPlaceholderText(/choose a new phrase/i), 'a long enough phrase');
    await user.click(screen.getByRole('button', { name: /recover my vault/i }));

    const error = await screen.findByText(/did not match this vault/i);
    expect(error).toBeInTheDocument();
    // No distinction between "no such vault" and "wrong code": either would
    // let someone probe for which vault ids exist.
    expect(error.textContent).not.toMatch(/not found|no such|does not exist/i);
  });
});

/**
 * The rule that gates the primary action.
 *
 * A disabled button with an unstated requirement is a dead end: the screen
 * gives no reason and the user has nothing to correct.
 */
describe('the length requirement', () => {
  it('states the rule before the user can fail it', () => {
    renderGate();
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
  });

  it('ties the rule to the field, so it is read on focus and not only seen', () => {
    renderGate();
    const field = screen.getByPlaceholderText(/a phrase you will remember/i);
    const described = (field.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toMatch(/at least 12 characters/i);
  });

  it('stops explaining once the phrase is long enough', async () => {
    const user = renderGate();
    await user.type(
      screen.getByPlaceholderText(/a phrase you will remember/i),
      'a long enough phrase',
    );
    expect(screen.queryByText(/at least 12 characters/i)).not.toBeInTheDocument();
  });
});

describe('how a failure is reported', () => {
  async function failARecovery() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );
    const user = renderGate();
    await user.click(screen.getByRole('button', { name: /i lost my phrase/i }));
    await user.type(
      screen.getByPlaceholderText(/vault id/i),
      '11111111-2222-3333-4444-555555555555',
    );
    await user.type(screen.getByPlaceholderText(/recovery code/i), 'ABCD-EFGH');
    await user.type(screen.getByPlaceholderText(/choose a new phrase/i), 'a long enough phrase');
    await user.click(screen.getByRole('button', { name: /recover my vault/i }));
    return screen.findByText(/did not match this vault/i);
  }

  it('announces the failure rather than only showing it', async () => {
    const error = await failARecovery();
    expect(error).toHaveAttribute('role', 'alert');
  });

  it('marks every submitted field invalid, singling none of them out', async () => {
    await failARecovery();
    // Flagging only the code — or only the id — would disclose through the
    // accessibility tree exactly what the error copy refuses to say.
    for (const placeholder of [/vault id/i, /recovery code/i, /choose a new phrase/i]) {
      expect(screen.getByPlaceholderText(placeholder)).toHaveAttribute('aria-invalid', 'true');
    }
  });
});
