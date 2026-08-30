/**
 * Crisis resources.
 *
 * UNSAID is not a crisis service and must never present itself as one. What it
 * can do is make the next step easy to find, in the right country, at the
 * moment someone needs it.
 *
 * Three rules govern everything in this file:
 *
 *   1. **Never block someone from writing.** The classifier routes what we show
 *      alongside their words; it never gates the vault. A person in distress
 *      being locked out of the one place they were willing to be honest is a
 *      worse outcome than anything this file prevents.
 *   2. **Never claim to be care.** No diagnosis, no assessment, no "we have
 *      detected". A signal is not a judgement about a person.
 *   3. **Never publish a number we have not verified.** Every entry below
 *      carries a `verifiedOn` date. Publishing a dead crisis line is worse than
 *      publishing none, because it costs someone the attempt.
 */

export interface CrisisResource {
  name: string;
  /** Dialable number, or null when the resource is text/web only. */
  phone: string | null;
  url?: string;
  hours: string;
  note?: string;
}

export interface CrisisRegion {
  /** ISO 3166-1 alpha-2, or 'default' for the international fallback. */
  region: string;
  label: string;
  resources: CrisisResource[];
  /**
   * When the numbers below were last confirmed reachable. Stale entries are a
   * liability; this date is what makes staleness visible in review.
   */
  verifiedOn: string | null;
}

/**
 * Nepal first — that is where the launch team and the first cohort are.
 *
 * VERIFICATION REQUIRED BEFORE LAUNCH: none of these have been dialled by us.
 * `verifiedOn: null` is deliberate and is what the launch gate checks; do not
 * set a date without actually calling the number.
 */
const REGIONS: CrisisRegion[] = [
  {
    region: 'NP',
    label: 'Nepal',
    verifiedOn: null,
    resources: [
      {
        name: 'Mental Health Helpline Nepal',
        phone: '1660 0102005',
        hours: 'Daily, daytime hours',
        note: 'Free from Nepal Telecom and Ncell lines.',
      },
      {
        name: 'TUTH Suicide Hotline',
        phone: '9840021600',
        hours: '24 hours',
      },
      {
        name: 'Emergency services',
        phone: '100',
        hours: '24 hours',
        note: 'Nepal Police, for immediate danger.',
      },
    ],
  },
  {
    region: 'IN',
    label: 'India',
    verifiedOn: null,
    resources: [
      { name: 'Tele-MANAS', phone: '14416', hours: '24 hours' },
      { name: 'Emergency services', phone: '112', hours: '24 hours' },
    ],
  },
  {
    region: 'US',
    label: 'United States',
    verifiedOn: null,
    resources: [
      {
        name: 'Suicide & Crisis Lifeline',
        phone: '988',
        hours: '24 hours',
        note: 'Call or text.',
      },
      { name: 'Emergency services', phone: '911', hours: '24 hours' },
    ],
  },
  {
    region: 'GB',
    label: 'United Kingdom',
    verifiedOn: null,
    resources: [
      { name: 'Samaritans', phone: '116 123', hours: '24 hours' },
      { name: 'Emergency services', phone: '999', hours: '24 hours' },
    ],
  },
];

/**
 * The fallback when we cannot tell where someone is, or have nothing verified
 * for their country. It deliberately points outward rather than guessing: a
 * wrong number is worse than an honest "here is how to find yours".
 */
const INTERNATIONAL: CrisisRegion = {
  region: 'default',
  label: 'Wherever you are',
  verifiedOn: null,
  resources: [
    {
      name: 'Find a helpline in your country',
      phone: null,
      url: 'https://findahelpline.com',
      hours: 'Varies',
      note: 'A directory of crisis lines worldwide.',
    },
  ],
};

/**
 * Resolves resources for a region.
 *
 * Region comes from a request hint, never from profiling the user. We do not
 * store it, and getting it wrong costs nothing — the fallback is a directory
 * rather than a wrong number.
 */
export function crisisResourcesFor(region?: string | null): CrisisRegion {
  if (!region) return INTERNATIONAL;
  const normalised = region.trim().toUpperCase();
  return REGIONS.find((entry) => entry.region === normalised) ?? INTERNATIONAL;
}

/** Every region we carry, for the Privacy Centre and the launch checklist. */
export function allCrisisRegions(): CrisisRegion[] {
  return [...REGIONS, INTERNATIONAL];
}

/**
 * The launch gate. Any region whose numbers have not been dialled by a human
 * shows up here, and the CI check fails while `REQUIRE_VERIFIED_CRISIS` is set.
 */
export function unverifiedRegions(): string[] {
  return allCrisisRegions()
    .filter((entry) => entry.verifiedOn === null)
    .map((entry) => entry.label);
}
