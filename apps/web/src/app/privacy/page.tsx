import { Shell } from '@/components/Shell';

/**
 * The Privacy Centre. Blueprint §11.5: a first-class screen, not a buried
 * policy page — and stated precisely enough to be falsifiable. Every claim
 * below corresponds to something enforced in code and covered by a test.
 */

const SECTIONS = [
  {
    title: 'What is encrypted, and where',
    body: 'Everything you write or record is encrypted on your device, before it is sent anywhere. Each memory gets its own key. Those keys are themselves encrypted with a key derived from your phrase, which never leaves your device. What our servers hold is a file of random-looking bytes and a wrapped key neither we nor anyone reading our database can unwrap.',
  },
  {
    title: 'What we can see',
    body: 'The date you saved something, whether it was voice or text, and how large the encrypted file is. That is the complete list. There is no column in our database for a title, a transcript, a mood, or a tag — not an empty one, not a hidden one.',
  },
  {
    title: 'When anything is read by AI',
    body: 'Only when you tap "Reflect" on one specific memory, and only after you have read the disclosure and confirmed it. That one memory is decrypted on your device and sent for a response. Your other memories are never included. We record which model answered and when — never what was said.',
  },
  {
    title: 'What happens when you delete',
    body: 'Deleting removes the encrypted file and its record. Forgetting goes further: it destroys the key first, so even if a copy of the encrypted file survives in a backup, nothing can ever read it again. That includes us. Neither can be undone.',
  },
  {
    title: 'If you lose your phrase',
    body: 'Your memories stay locked, permanently. We cannot reset it, and we cannot recover what is inside — not for you, not for anyone who asks on your behalf, not for a court order. This is the direct cost of the protection above, and you should decide whether you accept it before you rely on this.',
  },
  {
    title: 'What we do not promise',
    body: 'This is not unbreakable, and no system is. A device that is already compromised can read what you type before we ever encrypt it. We do not promise anonymity from someone with access to your device or your network. We do promise that a leak of our database or our storage does not expose what you wrote.',
  },
] as const;

export default function PrivacyPage() {
  return (
    <Shell screen="privacy">
      <div className="py-8">
        <h1 className="font-serif text-2xl text-ink">How this actually works</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Written plainly, because a privacy promise you cannot check is not worth much.
        </p>

        <div className="mt-10 flex flex-col gap-9">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-base text-ink">{section.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{section.body}</p>
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-line pt-8 text-xs leading-relaxed text-ink-faint">
          UNSAID is not a therapy service, a crisis line, or a diagnostic tool. If you are in
          immediate danger, please contact a local emergency service or someone you trust.
        </p>
      </div>
    </Shell>
  );
}
