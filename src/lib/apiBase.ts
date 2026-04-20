/** Base URL for the research API (no trailing slash). Empty = same origin (local dev). */
const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

export const apiBaseUrl = raw.replace(/\/$/, "");

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return apiBaseUrl ? `${apiBaseUrl}${p}` : p;
}
