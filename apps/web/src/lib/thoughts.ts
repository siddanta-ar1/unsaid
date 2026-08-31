import type {
  CaptureType,
  DeletionMode,
  ThoughtMetadata,
  ThoughtWithKey,
} from '@unsaid/types';
import { open, seal, sealText } from '@unsaid/crypto';
import { apiFetch, getCiphertext, putCiphertext } from './api';
import { track } from './signals';
import { toSizeBucket } from '@unsaid/types';

/**
 * The client-side capture pipeline. Every function here encrypts before it
 * calls the network — there is no code path in this file that sends readable
 * content anywhere.
 */

interface SaveArgs {
  token: string;
  key: CryptoKey;
  keyVersion: number;
}

async function saveSealed(
  sealed: Awaited<ReturnType<typeof seal>>,
  type: CaptureType,
  { token, key: _key, keyVersion: _keyVersion }: SaveArgs,
): Promise<ThoughtMetadata> {
  // 1. Ask where to put the bytes.
  const intent = await apiFetch<{ intentId: string; uploadUrl: string }>('/v1/thoughts/intents', {
    method: 'POST',
    token,
    body: {
      type,
      byteSize: sealed.ciphertext.byteLength,
      contentHash: sealed.contentHash,
    },
  });

  // 2. PUT ciphertext directly to storage, bypassing the API entirely.
  await putCiphertext(intent.uploadUrl, sealed.ciphertext);

  // 3. Register metadata and the wrapped key.
  const registered = await apiFetch<{ thought: ThoughtMetadata }>('/v1/thoughts', {
    method: 'POST',
    token,
    body: {
      intentId: intent.intentId,
      wrappedKey: sealed.wrappedKey,
      header: sealed.header,
    },
  });

  // Activation, per §24.3: a capture that reached a private save the user
  // chose — not an account creation.
  track({
    name: 'private_save_completed',
    storageMode: 'cloud',
    encryptedSizeBucket: toSizeBucket(sealed.ciphertext.byteLength),
  });

  return registered.thought;
}

export async function saveTextThought(text: string, args: SaveArgs): Promise<ThoughtMetadata> {
  const sealed = await sealText(text, args.key, args.keyVersion);
  return saveSealed(sealed, 'text', args);
}

export async function saveAudioThought(blob: Blob, args: SaveArgs): Promise<ThoughtMetadata> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sealed = await seal(bytes, args.key, args.keyVersion);
  return saveSealed(sealed, 'audio', args);
}

export async function listThoughts(token: string): Promise<ThoughtMetadata[]> {
  const result = await apiFetch<{ thoughts: ThoughtMetadata[] }>('/v1/thoughts', { token });
  return result.thoughts;
}

export interface OpenedThought {
  metadata: ThoughtWithKey;
  bytes: Uint8Array;
}

/** Fetches ciphertext and decrypts it in the browser. */
export async function openThought(
  id: string,
  token: string,
  key: CryptoKey,
): Promise<OpenedThought> {
  const { thought } = await apiFetch<{ thought: ThoughtWithKey }>(`/v1/thoughts/${id}`, { token });
  const ciphertext = await getCiphertext(thought.downloadUrl);
  const bytes = await open(
    ciphertext,
    thought.header as never,
    thought.wrappedKey,
    key,
  );
  return { metadata: thought, bytes };
}

export async function deleteThought(
  id: string,
  mode: Exclude<DeletionMode, 'local_discard'>,
  token: string,
): Promise<void> {
  await apiFetch(`/v1/thoughts/${id}`, { method: 'DELETE', token, body: { mode } });
}

export interface ReflectResult {
  quota: { limit: number; remaining: number };
  content: string;
  safetyNotice: 'none' | 'support_resources';
  support: {
    label: string;
    resources: { name: string; phone: string | null; url?: string; hours: string; note?: string }[];
  } | null;
}

export async function reflect(id: string, content: string, token: string): Promise<ReflectResult> {
  return apiFetch(`/v1/thoughts/${id}/reflect`, {
    method: 'POST',
    token,
    body: { consentVersion: 1, content },
  });
}

export async function grantReflectionConsent(token: string): Promise<void> {
  await apiFetch('/v1/consents', {
    method: 'POST',
    token,
    body: { scope: 'ai_reflection_once', version: 1, granted: true },
  });
}
