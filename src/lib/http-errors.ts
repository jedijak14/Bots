/** A failed HTTP response is not necessarily a network failure. */
export function chatHttpError(status: number): string {
  if (status === 401) return 'Your session may have expired. Sign in again and retry.';
  if (status === 413) return 'The message or attachment is too large for the server. Shorten it and try again.';
  if (status === 429) return 'The server is receiving too many requests. Wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) return `The server is temporarily unavailable (HTTP ${status}). Try again in a moment.`;
  if (status >= 500) return `The server encountered an error (HTTP ${status}). Try again; if it continues, report this status.`;
  return `The request failed (HTTP ${status}). Please try again.`;
}
