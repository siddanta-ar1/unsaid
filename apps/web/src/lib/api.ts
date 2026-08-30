import type { ApiError } from '@unsaid/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3011';

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Thin typed fetch wrapper. Every call goes through here so that the session
 * token has exactly one place it can be attached — and so no component is ever
 * tempted to hand-roll a request that includes content.
 */
export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const { method = 'GET', body, token } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      payload?.error.code ?? 'INTERNAL',
      payload?.error.message ?? 'Something went wrong.',
      response.status,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Uploads ciphertext straight to object storage; it never passes through the API. */
export async function putCiphertext(url: string, ciphertext: Uint8Array): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    body: ciphertext as unknown as BodyInit,
    headers: { 'content-type': 'application/octet-stream' },
  });
  if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
}

export async function getCiphertext(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
