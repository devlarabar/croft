export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    shouldRetry?: (err: unknown) => boolean;
    // Overrides the default 500ms*2^attempt backoff (e.g. to honor Retry-After).
    delayMs?: (err: unknown, attempt: number) => number;
  },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (attempt < opts.attempts - 1) {
        const delay = opts.delayMs?.(err, attempt) ?? 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

export function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  // postgres.js connection-level failures
  return ["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(code);
}
