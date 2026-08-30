import { decodeUtf8 } from '@unsaid/crypto';
import type { ThoughtMetadata } from '@unsaid/types';
import { listThoughts, openThought } from './thoughts';
import { ZipBuilder } from './zip';

/**
 * Vault export.
 *
 * This is the promise that makes the whole model credible: if you leave, you
 * leave with everything, in a form that does not need UNSAID to open. A vault
 * you cannot get out of is not yours — it is just someone else's silo with
 * better cryptography.
 *
 * Everything is decrypted in the browser. The server never participates beyond
 * handing over the same ciphertext it already stores.
 */

export interface ExportProgress {
  completed: number;
  total: number;
  /** Memories that could not be decrypted, reported rather than dropped. */
  failed: number;
}

interface ExportedEntry {
  metadata: ThoughtMetadata;
  text?: string;
  audio?: { bytes: Uint8Array; extension: string };
  error?: string;
}

/** Audio arrives as whatever the browser recorded; guess a sensible extension. */
function audioExtension(bytes: Uint8Array): string {
  // WebM/Matroska magic. MediaRecorder produces this in Chrome and Firefox.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'webm';
  }
  // 'ftyp' at offset 4 — MP4/M4A, what Safari records.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'm4a';
  }
  return 'bin';
}

function fileStem(metadata: ThoughtMetadata): string {
  const date = metadata.createdAt.slice(0, 19).replace(/[:T]/g, '-');
  return `${date}-${metadata.id.slice(0, 8)}`;
}

/**
 * Decrypts every active memory and packages it as a plain archive.
 *
 * A memory that fails to decrypt is recorded in the manifest rather than
 * silently omitted — an export that quietly loses entries is worse than one
 * that admits it could not read them.
 */
export async function exportVault({
  token,
  key,
  onProgress,
}: {
  token: string;
  key: CryptoKey;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<Blob> {
  const thoughts = await listThoughts(token);
  const entries: ExportedEntry[] = [];
  let failed = 0;

  for (const [index, metadata] of thoughts.entries()) {
    try {
      const opened = await openThought(metadata.id, token, key);
      entries.push(
        metadata.type === 'audio'
          ? {
              metadata,
              audio: { bytes: opened.bytes, extension: audioExtension(opened.bytes) },
            }
          : { metadata, text: decodeUtf8(opened.bytes) },
      );
    } catch {
      failed += 1;
      entries.push({ metadata, error: 'Could not be decrypted with this vault key.' });
    }
    onProgress?.({ completed: index + 1, total: thoughts.length, failed });
  }

  const zip = new ZipBuilder();
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const stem = fileStem(entry.metadata);
    if (entry.text !== undefined) {
      zip.add(`memories/${stem}.txt`, encoder.encode(entry.text));
    } else if (entry.audio) {
      zip.add(`memories/${stem}.${entry.audio.extension}`, entry.audio.bytes);
    }
  }

  zip.add(
    'manifest.json',
    encoder.encode(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          formatVersion: 1,
          count: entries.length,
          failed,
          memories: entries.map((entry) => ({
            id: entry.metadata.id,
            type: entry.metadata.type,
            createdAt: entry.metadata.createdAt,
            file:
              entry.text !== undefined
                ? `memories/${fileStem(entry.metadata)}.txt`
                : entry.audio
                  ? `memories/${fileStem(entry.metadata)}.${entry.audio.extension}`
                  : null,
            error: entry.error ?? null,
          })),
        },
        null,
        2,
      ),
    ),
  );

  zip.add(
    'README.txt',
    encoder.encode(
      [
        'YOUR UNSAID EXPORT',
        '',
        `Exported ${new Date().toISOString().slice(0, 10)}.`,
        '',
        'Everything here is decrypted and readable without UNSAID. Text memories',
        'are plain .txt files; voice memories are audio files any player opens.',
        'manifest.json lists everything with its original date.',
        '',
        'This archive is NOT encrypted. Anyone who opens it can read everything.',
        'Store it the way you would store a paper diary.',
        '',
        failed > 0
          ? `${failed} memory/memories could not be decrypted and are listed in the manifest.`
          : 'All memories exported successfully.',
      ].join('\n'),
    ),
  );

  return zip.finish();
}
