/** Returns whether a failed request is likely to succeed if retried. */
export function retryableAiError(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status !== undefined) return status === 408 || status === 409 || status === 429 || status >= 500;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|network|fetch failed|connection reset|econnreset|eai_again/i.test(message);
}

/** Keeps persisted diagnostic text safe to display in the Review UI and reports. */
export function safeAiErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/(?:sk|api[_-]?key)[-_a-z0-9]{8,}/gi, '[redacted]')
      .replace(/\s+/g, ' ')
      .slice(0, 240) || 'AI classification failed.'
  );
}
