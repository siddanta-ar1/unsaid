'use client';

/**
 * The disclosure shown before any content leaves the encrypted boundary.
 * Blueprint §8.3 and §18.2: the user is told what leaves the device, where it
 * goes, and what is kept — before it happens, not in a policy page afterwards.
 *
 * The wording here is a product-safety artefact. Changing it should also bump
 * the consent version recorded server-side, because the version is what the
 * user actually agreed to.
 */
export function ReflectConsentSheet({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper-raised p-6">
        <h2 className="font-serif text-xl text-ink">Before Echo reads this</h2>

        <ul className="mt-5 flex flex-col gap-3 text-sm leading-relaxed text-ink-soft">
          <li>
            <span className="text-ink">This memory will be decrypted</span> on your device and sent
            to an AI provider so it can respond. It is the only thing sent — not your vault.
          </li>
          <li>
            <span className="text-ink">We do not keep the text</span> of what was sent or what came
            back. Only the model name and the time are recorded.
          </li>
          <li>
            <span className="text-ink">Echo is not a therapist.</span> It reflects on what you
            wrote. It cannot diagnose anything, and it is not a crisis service.
          </li>
          <li>You can turn this off again at any time in the Privacy Centre.</li>
        </ul>

        <div className="mt-7 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-ink px-5 py-3 text-paper"
          >
            I understand — send this one
          </button>
          <button type="button" onClick={onCancel} className="px-5 py-3 text-sm text-ink-soft">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
