// Keep actionable domain validation messages, but never display SQL, bound values,
// driver diagnostics or nested query failures in native error UI.
export function userFacingError(error: unknown, fallback: string): string {
  let candidate: unknown = error;
  for (let depth = 0; candidate && typeof candidate === 'object' && depth < 4; depth++) {
    const row = candidate as { name?: unknown; code?: unknown; query?: unknown; message?: unknown; cause?: unknown };
    if (/sqlite|drizzlequery/i.test(String(row.name ?? '')) || /^SQLITE_/i.test(String(row.code ?? ''))
      || typeof row.query === 'string' || /failed query:|sqlite_|sql logic error|no such (table|column)|constraint failed/i.test(String(row.message ?? ''))) return fallback;
    candidate = row.cause;
  }
  return error instanceof Error ? error.message : fallback;
}
