// A secret must never reach the database, the dashboard, or container logs:
// git and provider SDKs put credentials into their error text, and those
// strings get stored and displayed. Applied at every persist/log boundary.
export function redact(text: string): string {
  return text
    .replace(/gh[posur]_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    // credentials embedded in a URL: https://user:password@host
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@");
}

export function redactDeep<T>(value: T): T {
  return JSON.parse(redact(JSON.stringify(value))) as T;
}
