import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackButton } from './FeedbackButton';
import { VaultProvider } from '@/lib/vault';

/**
 * In-app feedback.
 *
 * The message box is the one place in the entire product where a person may
 * deliberately write something we can read. These tests hold that boundary:
 * what is sent must be the screen and the sentiment, never anything the
 * component could scrape from the page around it.
 */

function renderFeedback(screenName: 'capture' | 'memory' = 'capture') {
  render(
    <VaultProvider>
      <FeedbackButton screen={screenName} />
    </VaultProvider>,
  );
  return userEvent.setup();
}

function lastRequestBody(): Record<string, unknown> {
  const mock = vi.mocked(globalThis.fetch);
  const [, init] = mock.mock.calls.at(-1) ?? [];
  return JSON.parse(String((init as RequestInit).body));
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ received: true }) }),
  );
});

describe('opening it', () => {
  it('stays out of the way until asked for', async () => {
    renderFeedback();
    expect(screen.getByRole('button', { name: /something felt off/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cannot be sent without saying what kind of problem it was', async () => {
    const user = renderFeedback();
    await user.click(screen.getByRole('button', { name: /something felt off/i }));
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });
});

describe('what gets sent', () => {
  it('carries the screen and sentiment only', async () => {
    const user = renderFeedback('memory');

    await user.click(screen.getByRole('button', { name: /something felt off/i }));
    await user.click(screen.getByRole('button', { name: /this confused me/i }));
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    const body = lastRequestBody();
    expect(body).toEqual({ screen: 'memory', sentiment: 'confused' });
  });

  it('includes the note only when one was written', async () => {
    const user = renderFeedback();

    await user.click(screen.getByRole('button', { name: /something felt off/i }));
    await user.click(screen.getByRole('button', { name: /something broke/i }));
    await user.type(screen.getByRole('textbox'), 'the save button did nothing');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(lastRequestBody()).toEqual({
      screen: 'capture',
      sentiment: 'broken',
      message: 'the save button did nothing',
    });
  });

  it('omits a note that is only whitespace', async () => {
    const user = renderFeedback();

    await user.click(screen.getByRole('button', { name: /something felt off/i }));
    await user.click(screen.getByRole('button', { name: /i have an idea/i }));
    await user.type(screen.getByRole('textbox'), '   ');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(lastRequestBody()).not.toHaveProperty('message');
  });
});

describe('the warning', () => {
  it('says a human reads the box before anyone types in it', async () => {
    const user = renderFeedback();
    await user.click(screen.getByRole('button', { name: /something felt off/i }));

    // Placed above the send button and beside the field, not after the fact.
    expect(screen.getByText(/a person reads this/i)).toBeInTheDocument();
    expect(screen.getByText(/do not paste anything private/i)).toBeInTheDocument();
  });
});

describe('afterwards', () => {
  it('confirms what was and was not sent', async () => {
    const user = renderFeedback();

    await user.click(screen.getByRole('button', { name: /something felt off/i }));
    await user.click(screen.getByRole('button', { name: /something else/i }));
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing about what you wrote/i)).toBeInTheDocument();
  });

  it('explains a failure rather than pretending it sent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const user = renderFeedback();

    await user.click(screen.getByRole('button', { name: /something felt off/i }));
    await user.click(screen.getByRole('button', { name: /something broke/i }));
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText(/did not send/i)).toBeInTheDocument();
    expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument();
  });
});
