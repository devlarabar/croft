import { LlmTransportError } from "./llm/types.js";

export function errorSummary(error: unknown): string {
  if (error instanceof LlmTransportError) {
    const status = Number.isInteger(error.status) ? ` (HTTP ${error.status})` : "";
    return `Model request failed${status}. Check model access and retry.`;
  }
  return "Operation failed. Please retry.";
}

const SECRET_FIELD = "(?:api[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|authorization|x-api-key|token_enc_key|database_url)";
const secretField = new RegExp(`^${SECRET_FIELD}$`, "i");
const secretAssignment = new RegExp(String.raw`(["']?\b${SECRET_FIELD}["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)`, "gi");

export function redact(text: string): string {
  return text
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[redacted]")
    .replace(/gh[posur]_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/\bsk-(?:ant-[A-Za-z0-9_-]+|proj-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{20,})/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/((?:https?|postgres(?:ql)?):\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@")
    .replace(secretAssignment, (_match, prefix: string, value: string) => {
      const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : "";
      return `${prefix}${quote}[redacted]${quote}`;
    });
}

export function redactDeep<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value, (field, item: unknown) => {
    if (typeof item !== "string") return item;
    return secretField.test(field) ? "[redacted]" : redact(item);
  }));
}
