const configured = (
  import.meta.env.VITE_API_BASE ||
  "https://yixu-photo-atlas.hxsophie8-6ff.workers.dev"
).replace(/\/$/, "");

export const apiBase = configured;
export const apiReady = Boolean(configured && !configured.includes("REPLACE_ME"));

export function apiUrl(path: string) {
  if (!apiReady) throw new Error("The Cloudflare backend has not been connected yet.");
  return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}
