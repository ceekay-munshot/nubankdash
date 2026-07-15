// src/lib/api.ts
//
// Thin fetch helper for Munshot's registered datasources. Every request is
// authenticated with the host-provided JWT as `Authorization: Bearer <token>`
// (auth-standards §7). Base URLs come from the datasource registry:
//   fastapi -> https://fastapi.muns.io      nestjs -> https://devde.muns.io
// Only registered endpoints are called; no tokens or tickers are hardcoded.

export const BASE_URLS = {
  fastapi: "https://fastapi.muns.io",
  nestjs: "https://devde.muns.io",
} as const;

export type Service = keyof typeof BASE_URLS;

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Authenticated JSON request against a registered datasource.
 * Throws ApiError with no token so callers can render "Waiting for session…".
 */
export async function authFetch<T = unknown>(
  service: Service,
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  if (!token) throw new ApiError("No session token", 401);
  const res = await fetch(`${BASE_URLS[service]}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

/** A row from GET /portfolio/list (portfolio_list datasource). */
export interface PortfolioItem {
  id: string;
  ticker: string;
  rank: number;
  company_name?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
}

export function fetchPortfolio(token: string | null, signal?: AbortSignal) {
  return authFetch<PortfolioItem[]>("nestjs", "/portfolio/list", token, { signal });
}
