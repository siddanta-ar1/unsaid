/**
 * What we can see, beside what we cannot, as one list.
 *
 * This replaced two paragraphs. A reader comparing two prose passages has to
 * hold one in their head while reading the other; side by side the comparison
 * is just there. The left column is deliberately complete — it is short, and a
 * short honest list is more convincing than a long reassuring one.
 *
 * Colour is not carrying the meaning on its own: each row is in a titled
 * column and the icons are labelled, so the distinction survives both
 * colour-blindness and a screen reader.
 */

const VISIBLE = [
  ['The date you saved something', 'A timestamp, to sort your vault'],
  ['Whether it was voice or text', 'To know which player to show'],
  ['How large the encrypted file is', 'To bill storage and spot abuse'],
  ['That an access happened', 'Written to the public consent ledger'],
] as const;

const HIDDEN = [
  ['What you wrote or said', 'Encrypted before it leaves your device'],
  ['A title, summary or transcript', 'No such column exists in our database'],
  ['Your mood, tags or categories', 'The product never asks you for them'],
  ['Anything after you forget it', 'The key is destroyed first, so the bytes are noise'],
] as const;

export function VisibilityLedger() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-2xl border border-caution bg-caution-wash p-5 sm:p-6">
        <h3 className="font-serif text-lg text-ink">What we can see</h3>
        <p className="mt-1 text-sm text-caution">
          The complete list. There is nothing below this.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {VISIBLE.map(([what, why]) => (
            <li key={what} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm text-ink">{what}</p>
              <p className="mt-0.5 text-sm text-ink-soft">{why}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-safe bg-safe-wash p-5 sm:p-6">
        <h3 className="font-serif text-lg text-ink">What we cannot</h3>
        <p className="mt-1 text-sm text-safe">
          Not by policy — we built it so that we are unable to.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {HIDDEN.map(([what, why]) => (
            <li key={what} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm text-ink">{what}</p>
              <p className="mt-0.5 text-sm text-ink-soft">{why}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
