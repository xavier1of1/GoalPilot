function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/**
 * Owns one idempotency key for one logical mutation payload. Failed or ambiguous
 * responses keep the key; success explicitly clears it. A changed payload gets
 * a new key even when the same mutation control is reused.
 */
export class LogicalMutationKey {
  private active: { readonly fingerprint: string; readonly key: string } | null = null;

  keyFor(payload: unknown): string {
    const fingerprint = JSON.stringify(canonicalize(payload));
    if (this.active?.fingerprint !== fingerprint) {
      this.active = { fingerprint, key: crypto.randomUUID() };
    }
    return this.active.key;
  }

  clear(): void {
    this.active = null;
  }
}
