import { Shell } from '@/components/Shell';

export const metadata = { title: 'Terms of Use — UNSAID' };

/**
 * Terms of use.
 *
 * NOT YET REVIEWED BY A LAWYER. The safety and liability sections in particular
 * need a Nepal-qualified review before launch — a product adjacent to mental
 * health has obligations a generic template will not cover.
 */
export default function TermsPage() {
  return (
    <Shell screen="privacy">
      <article className="py-8">
        <h1 className="font-serif text-2xl text-ink">Terms of Use</h1>
        <p className="mt-2 text-xs text-ink-faint">Last updated 30 August 2026</p>

        <Section title="What UNSAID is">
          A private place to write or speak things you would rather not say aloud, and to keep
          them under your own control.
        </Section>

        <Section title="What UNSAID is not">
          It is not therapy, counselling, medical care, or a crisis service. It cannot assess how
          you are, and nothing it shows you is a diagnosis. Echo is a reflection assistant, not a
          clinician. If you are in danger, contact a local emergency service or someone you trust.
        </Section>

        <Section title="Your responsibility for your key">
          Your phrase and recovery kit are the only way into your vault. We do not hold them and
          cannot recover them. Keeping them safe is your responsibility, and losing both means
          losing access permanently.
        </Section>

        <Section title="Age">
          You must be at least 16 to use UNSAID.
        </Section>

        <Section title="Acceptable use">
          Do not use UNSAID to store or transmit content that is illegal where you live, or to
          attempt to disrupt the service for others. We may rate-limit or block clients that abuse
          the service; because we cannot read your content, such decisions are based only on
          traffic patterns.
        </Section>

        <Section title="Availability">
          This is early software offered as it is. We do not guarantee uninterrupted availability,
          and you should keep your own export if your memories matter to you — the export control
          in Settings exists for exactly that.
        </Section>

        <Section title="Changes">
          If we change these terms materially, we will say so in the app before the change takes
          effect.
        </Section>

        <Section title="Contact">
          <span className="font-mono text-ink">hello@unsaid.app</span>
        </Section>
      </article>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base text-ink">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}
