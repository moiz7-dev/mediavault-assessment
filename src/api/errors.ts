/**
 * Structural error type for the API client. Callers branch on `code` / `status`,
 * never on `message` text — the API contract (API.md) guarantees `code` is stable.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;
  /** True for failures the API contract documents as safe to repeat unchanged. */
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    // 429 (rate limited), 503 (upstream_unavailable) and 500 (write_failed) are the
    // only statuses the contract documents as transient. Everything else (400/404/409/422)
    // means the request itself was wrong and retrying it unchanged will fail again.
    this.retryable = status === 429 || status === 503 || status === 500;
  }
}

/** A `fetch` rejection (offline, DNS failure, connection reset) rather than an HTTP error. */
export class NetworkError extends Error {
  readonly retryable = true;
  constructor(message = 'Network request failed.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError ? err.retryable : err instanceof NetworkError;
}

/** User-facing copy for known error codes. Falls back to a generic, non-technical message. */
const FRIENDLY_MESSAGES: Record<string, string> = {
  rate_limited: "You're doing that a bit fast — retrying shortly.",
  upstream_unavailable: 'The library is momentarily unavailable — retrying.',
  write_failed: "That change didn't save — retrying.",
  version_conflict: 'Someone else changed this asset. Refresh it before trying again.',
  stale_cursor: 'The list changed — resetting to the top.',
  invalid_name: 'Names need to be at least 3 characters.',
  invalid_status: "That status isn't valid.",
  invalid_tags: 'Tags must be plain text.',
  legal_hold: 'This asset is on legal hold and cannot be changed this way.',
  not_found: 'That asset no longer exists.',
  too_many_ids: 'Too many items selected for one request.',
  thumbnail_missing: 'No preview image for this asset.',
};

export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY_MESSAGES[err.code] ?? err.message;
  if (err instanceof NetworkError) return "You're offline — reconnect and we'll retry.";
  if (err instanceof Error) return 'Something went wrong. Please try again.';
  return 'Something went wrong. Please try again.';
}
