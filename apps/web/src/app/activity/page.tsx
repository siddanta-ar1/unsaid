'use client';

import { Shell } from '@/components/Shell';
import { UnlockGate } from '@/components/UnlockGate';
import { AccessLog } from '@/components/AccessLog';

/** The access log. Blueprint §13, and the reason the ledger exists. */
export default function ActivityPage() {
  return (
    <Shell screen="activity">
      <UnlockGate>
        <AccessLog />
      </UnlockGate>
    </Shell>
  );
}
