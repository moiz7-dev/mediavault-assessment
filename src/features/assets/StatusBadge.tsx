import { statusLabel } from '@/lib/format';
import type { AssetStatus } from '@/lib/types';

/** Position in the draft -> in review -> approved -> archived pipeline, 1-indexed. */
const STEP: Record<AssetStatus, number> = { draft: 1, in_review: 2, approved: 3, archived: 4 };
const STEPS = [1, 2, 3, 4];

/**
 * Status as a 4-dot progression rather than an unordered colour chip: the dot *count* is the
 * primary signal (readable without colour), the tint/label are the faster secondary scan.
 */
export function StatusBadge({ status }: { status: AssetStatus }) {
  const step = STEP[status];
  return (
    <span className={`status status--${status}`}>
      <span className="status__dots" aria-hidden="true">
        {STEPS.map((i) => (
          <span key={i} className={'status__dot' + (i <= step ? ' status__dot--filled' : '')} />
        ))}
      </span>
      {statusLabel(status)}
    </span>
  );
}
