/**
 * Retrying database work that failed because the connection died.
 *
 * A dropped socket is not the query's fault: the statement never ran, so
 * running it again is safe. This only retries connection-level failures —
 * a constraint violation or a syntax error is rethrown immediately, and a
 * caller can opt out for a statement that is not idempotent.
 */

const CONNECTION_ERROR = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|Connection terminated|connection is closed|Client has encountered a connection error|terminating connection|sorry, too many clients|timeout exceeded when trying to connect|connection timeout|remaining connection slots are reserved/i;

export function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${(error as { cause?: unknown }).cause ?? ""}` : String(error);
  return CONNECTION_ERROR.test(message);
}

export async function withDbRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isConnectionError(error) || attempt === attempts) throw error;
      // Small, increasing pause: the pool may need a moment to mint a client.
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
  throw lastError;
}
