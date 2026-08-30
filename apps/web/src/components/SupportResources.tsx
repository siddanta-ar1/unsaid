'use client';

interface Resource {
  name: string;
  phone: string | null;
  url?: string;
  hours: string;
  note?: string;
}

/**
 * Shown alongside a memory when the safety signal fired.
 *
 * It never blocks the vault and never claims to be care. A person in distress
 * being locked out of the one place they were willing to be honest is a worse
 * outcome than anything this panel prevents — so it sits beside their words,
 * not in front of them.
 */
export function SupportResources({
  label,
  resources,
}: {
  label: string;
  resources: Resource[];
}) {
  return (
    <aside className="mt-6 rounded-xl border border-line bg-paper-raised p-6">
      <p className="text-sm leading-relaxed text-ink">
        That sounds heavy to be carrying. You do not have to hold it on your own.
      </p>

      <p className="mt-4 text-xs uppercase tracking-wide text-ink-faint">{label}</p>

      <ul className="mt-3 flex flex-col gap-3">
        {resources.map((resource) => (
          <li key={resource.name} className="text-sm leading-relaxed">
            <span className="text-ink">{resource.name}</span>
            {resource.phone && (
              <>
                {' — '}
                <a
                  href={`tel:${resource.phone.replace(/\s/g, '')}`}
                  className="font-mono text-ink underline underline-offset-4"
                >
                  {resource.phone}
                </a>
              </>
            )}
            {resource.url && (
              <>
                {' — '}
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink underline underline-offset-4"
                >
                  {resource.url.replace(/^https?:\/\//, '')}
                </a>
              </>
            )}
            <span className="block text-xs text-ink-faint">
              {resource.hours}
              {resource.note ? ` · ${resource.note}` : ''}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-ink-faint">
        UNSAID is not a crisis service and cannot assess how you are. Your memory is saved and
        untouched, exactly as you wrote it.
      </p>
    </aside>
  );
}
