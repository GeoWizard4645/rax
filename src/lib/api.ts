export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Best human message from either our `{error, message}` or Rateboard's own `{error: "text"}`. */
export function messageOf(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const m = d.message ?? d.error;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Network error — check your connection.', 0, 'network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(messageOf(data, `Request failed (${res.status}).`), res.status, (data as any)?.error);
  return data as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('Network error — check your connection.', 0, 'network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(messageOf(data, `Request failed (${res.status}).`), res.status, (data as any)?.error);
  return data as T;
}
