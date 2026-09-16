/**
 * The mark.
 *
 * A speech bubble holding three dots — and the last one never left. Two dots
 * are knocked out to the page colour, so the mark inverts correctly in dark
 * mode without a second asset; the third is coral, the only warm mark in the
 * interface.
 *
 * The bubble takes `currentColor`, so it inherits whatever type colour it sits
 * beside. Do not give it a fixed fill.
 */
export function Logo({
  size = 26,
  withWordmark = false,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        d="M9 4h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-7.5l-5.2 4.3a1 1 0 0 1-1.63-.9L9.4 24H9a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6Z"
        fill="currentColor"
      />
      <circle cx="11.2" cy="14" r="1.9" className="fill-paper" />
      <circle cx="16" cy="14" r="1.9" className="fill-paper" />
      <circle cx="20.8" cy="14" r="1.9" className="fill-accent" />
    </svg>
  );

  if (!withWordmark) return <span className={className}>{mark}</span>;

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      {mark}
      <span className="font-serif text-lg tracking-wide">UNSAID</span>
    </span>
  );
}
