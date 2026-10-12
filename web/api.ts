export async function api<T>(path: string, method = 'GET', key?: string): Promise<T> {
  const response = await fetch(path, { method, headers: key ? { 'Idempotency-Key': key } : {} });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result as T;
}
export const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
