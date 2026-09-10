// Redacts recognizable GitHub tokens and credentials embedded in URLs.
export function redact(text: string): string {
  return text
    .replace(/gh[posur]_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    // credentials embedded in a URL: https://user:password@host
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@");
}

export function redactDeep(value: unknown): object {
  return JSON.parse(redact(JSON.stringify(value)));
}
