import { useEffect, useState } from 'react';
import { getAsset, thumbnailUrl, updateAsset } from '@/api/client';
import { ApiError, friendlyMessage } from '@/api/errors';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAsset(null);
    setError(null);
    setConflictNotice(null);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) => setError(friendlyMessage(err)));
  }, [id]);

  async function setStatus(status: AssetStatus) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setConflictNotice(null);
    try {
      const updated = await updateAsset(asset.id, asset.version, { status });
      setAsset(updated);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        // Someone else's write landed first. Refetching and asking the user to re-confirm,
        // rather than silently retrying with the new version, is the safer default: we don't
        // know whether our change still makes sense against whatever they just changed it to.
        // One extra click beats a silently clobbered concurrent edit.
        try {
          const fresh = await getAsset(asset.id);
          setAsset(fresh);
          setConflictNotice(
            'This asset changed elsewhere — refreshed to the latest version. Choose a status again to apply your change.',
          );
        } catch (refetchErr) {
          setError(friendlyMessage(refetchErr));
        }
      } else {
        setError(friendlyMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button onClick={onClose}>Close</button>
      </div>

      {error && <p className="error">{error}</p>}
      {conflictNotice && <p className="notice">{conflictNotice}</p>}
      {!asset && !error && <p className="muted">Loading…</p>}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
