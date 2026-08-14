const SENSITIVE_KEY_PATTERN = /^(access_?token|refresh_?token|client_?secret|code_?verifier|api_?key|secret|password|auth|authorization|verifier_?encrypted)$/i;

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,255}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    pattern: /\bya29\.[A-Za-z0-9\-_]+\b/g,
    replacement: "[REDACTED_GOOGLE_TOKEN]",
  },
  {
    pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    pattern: /(Bearer\s+)[A-Za-z0-9\-_.~+/]+=*/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /([?&](?:access_token|refresh_token|client_secret|code_verifier|api_key|token)=)([^&#\s]+)/gi,
    replacement: "$1[REDACTED]",
  },
];

/**
 * Mask a secret string, leaving a small hint if long enough, or fully redacting if short.
 */
export function maskSecret(secret: string, visibleChars = 4): string {
  if (!secret || typeof secret !== "string") return "";
  const trimmed = secret.trim();
  if (trimmed.length <= visibleChars * 2) {
    return "[REDACTED]";
  }
  const prefix = trimmed.slice(0, visibleChars);
  const suffix = trimmed.slice(-visibleChars);
  return `${prefix}...${suffix}`;
}

/**
 * Scrub known secrets and recognizable secret patterns from text.
 */
export function scrubSensitiveText(text: string, knownSecrets: string[] = []): string {
  if (!text || typeof text !== "string") return text;
  let result = text;

  // Scrub known exact secrets first
  for (const secret of knownSecrets) {
    if (secret && typeof secret === "string" && secret.length >= 4) {
      if (result.includes(secret)) {
        result = result.split(secret).join("[REDACTED]");
      }
    }
  }

  // Scrub well-known secret patterns
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Deeply clone and sanitize an audit detail payload or structured object,
 * redacting any sensitive properties.
 */
export function sanitizeAuditDetail<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    return scrubSensitiveText(input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeAuditDetail(item)) as unknown as T;
  }
  if (typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = typeof value === "string" ? maskSecret(value) : "[REDACTED]";
      } else {
        output[key] = sanitizeAuditDetail(value);
      }
    }
    return output as unknown as T;
  }
  return input;
}
