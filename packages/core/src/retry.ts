export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; shouldRetry?: (err: unknown) => boolean },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (i < opts.attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

export function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  // postgres.js connection-level failures
  return ["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(code);
}
