/**
 * The one picture the product needs: what you wrote, beside what we hold.
 *
 * It is not an illustration of the idea — it is the idea, shown literally. The
 * left panel is a sentence; the right is what that sentence looks like after
 * the device seals it, which is what actually sits in our database. Nobody has
 * to take the architecture on faith to understand the difference.
 *
 * Deliberately quiet: no accent colour, no motion, no icons. The ciphertext is
 * static sample text rather than a live encryption, because a decorative
 * animation here would be the product performing at someone who came to it at
 * 2am.
 */

/** Sample output, not generated per render: identical bytes on server and client. */
const CIPHERTEXT =
  'TdmQyR0xJc0hZZk5rVmJQcDJ3TGpBOW5FeFF2U3RHaUZrMmRBc0x3UXpY' +
  'bk1jVUJoVjZwWXJKZ0Y3dEEwOHNEaEtlTnFXeUxtUjNiVGNVaFpnOUp2' +
  'RW9YNHNQd0RmTTJhSnRLcUJ5TjVIZ1ZjUnoxbEVwVXNXb0Q4aEZ0TmJR';

export function TrustBoundary() {
  return (
    <figure className="mt-10">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch sm:gap-5">
        <div className="flex flex-col">
          <p className="text-xs uppercase tracking-[0.12em] text-ink-faint">What you write</p>
          <div className="mt-2 flex-1 rounded-xl border border-line bg-paper-raised p-4">
            <p className="font-serif text-base leading-relaxed text-ink">
              I have not told anyone how tired I am.
            </p>
          </div>
        </div>

        {/* The boundary. Horizontal rule when stacked, vertical when side by side. */}
        <div
          aria-hidden="true"
          className="flex items-center justify-center sm:w-px sm:flex-col"
        >
          <span className="h-px w-full border-t border-dashed border-field sm:h-full sm:w-px sm:border-l sm:border-t-0" />
        </div>

        <div className="flex flex-col">
          <p className="text-xs uppercase tracking-[0.12em] text-ink-faint">What we store</p>
          <div className="mt-2 flex-1 overflow-hidden rounded-xl border border-line bg-paper-raised p-4">
            <p
              // `break-all` because this is bytes, not prose — it should fill
              // the box the way a hex dump does, at any width.
              className="break-all font-mono text-[11px] leading-[1.45] text-ink-faint sm:text-xs"
            >
              {CIPHERTEXT}
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-ink-faint">
        The same memory, on both sides of the line. Encryption happens on your device, so the
        right-hand panel is everything a leak of our database would expose.
      </figcaption>
    </figure>
  );
}
