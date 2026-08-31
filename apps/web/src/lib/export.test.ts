import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVault } from '@unsaid/crypto';
import type { ThoughtMetadata } from '@unsaid/types';

/**
 * Vault export, assembled end to end.
 *
 * `zip.test.ts` proves the archive format is valid; this proves the right
 * things go into it. The promise being tested is the one that makes the whole
 * encryption model credible: if you leave, you leave with everything, readable
 * without us.
 */

vi.mock('./thoughts', () => ({
  listThoughts: vi.fn(),
  openThought: vi.fn(),
}));

const { listThoughts, openThought } = await import('./thoughts');
const { exportVault } = await import('./export');

const vault = await createVault('a passphrase for the export suite');

function metadata(overrides: Partial<ThoughtMetadata> = {}): ThoughtMetadata {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    type: 'text',
    status: 'active',
    contentHash: 'hash',
    encryptionVersion: 1,
    byteSize: 128,
    createdAt: '2026-08-30T21:32:00.000Z',
    updatedAt: '2026-08-30T21:32:00.000Z',
    anchored: false,
    ...overrides,
  };
}

/** Writes the produced archive and reads it back with Python's zipfile. */
async function inspect(archive: Blob, script: string): Promise<string> {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const path = join(mkdtempSync(join(tmpdir(), 'unsaid-export-')), 'export.zip');
  writeFileSync(path, bytes);
  return execFileSync('python3', ['-c', script, path], { encoding: 'utf8' }).trim();
}

const run = () => exportVault({ token: 'token', key: vault.vaultKey });

beforeEach(() => {
  vi.mocked(listThoughts).mockReset();
  vi.mocked(openThought).mockReset();
});

describe('what the archive contains', () => {
  it('writes text memories as plain files anyone can open', async () => {
    const secret = 'I rehearsed this and never said it.';

    vi.mocked(listThoughts).mockResolvedValue([metadata()]);
    vi.mocked(openThought).mockResolvedValue({
      metadata: {} as never,
      bytes: new TextEncoder().encode(secret),
    });
    const contents = await inspect(
      await run(),
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'n=[x for x in z.namelist() if x.startswith("memories/")][0]\n' +
        'sys.stdout.write(z.read(n).decode("utf-8"))',
    );
    expect(contents).toBe(secret);
  });

  it('always ships a manifest and a README', async () => {
    vi.mocked(listThoughts).mockResolvedValue([]);

    const names = await inspect(
      await run(),
      'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(",".join(sorted(z.namelist())))',
    );
    expect(names).toBe('README.txt,manifest.json');
  });

  it('names files by date so an archive is browsable without the manifest', async () => {
    vi.mocked(listThoughts).mockResolvedValue([metadata()]);
    vi.mocked(openThought).mockResolvedValue({
      metadata: {} as never,
      bytes: new TextEncoder().encode('x'),
    });

    const names = await inspect(
      await run(),
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print([x for x in z.namelist() if x.startswith("memories/")][0])',
    );
    expect(names).toMatch(/^memories\/2026-08-30-21-32-00-11111111\.txt$/);
  });
});

describe('audio', () => {
  it('recognises WebM from its magic bytes', async () => {
    const webm = new Uint8Array(64);
    webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);

    vi.mocked(listThoughts).mockResolvedValue([metadata({ type: 'audio' })]);
    vi.mocked(openThought).mockResolvedValue({ metadata: {} as never, bytes: webm });

    const names = await inspect(
      await run(),
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print([x for x in z.namelist() if x.startswith("memories/")][0])',
    );
    expect(names).toMatch(/\.webm$/);
  });

  it('recognises MP4/M4A, which is what Safari records', async () => {
    const m4a = new Uint8Array(64);
    m4a.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'

    vi.mocked(listThoughts).mockResolvedValue([metadata({ type: 'audio' })]);
    vi.mocked(openThought).mockResolvedValue({ metadata: {} as never, bytes: m4a });

    const names = await inspect(
      await run(),
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print([x for x in z.namelist() if x.startswith("memories/")][0])',
    );
    expect(names).toMatch(/\.m4a$/);
  });

  it('preserves audio bytes exactly', async () => {
    const audio = new Uint8Array(8192);
    crypto.getRandomValues(audio);
    audio.set([0x1a, 0x45, 0xdf, 0xa3], 0);

    vi.mocked(listThoughts).mockResolvedValue([metadata({ type: 'audio' })]);
    vi.mocked(openThought).mockResolvedValue({ metadata: {} as never, bytes: audio });

    const digest = await inspect(
      await run(),
      'import sys,zipfile,hashlib\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'n=[x for x in z.namelist() if x.startswith("memories/")][0]\n' +
        'print(hashlib.sha256(z.read(n)).hexdigest())',
    );
    const expected = Buffer.from(
      await crypto.subtle.digest('SHA-256', audio as BufferSource),
    ).toString('hex');
    expect(digest).toBe(expected);
  });
});

describe('when a memory cannot be decrypted', () => {
  it('records it in the manifest rather than dropping it silently', async () => {
    vi.mocked(listThoughts).mockResolvedValue([
      metadata({ id: 'aaaaaaaa-0000-0000-0000-000000000000' }),
      metadata({ id: 'bbbbbbbb-0000-0000-0000-000000000000' }),
    ]);
    vi.mocked(openThought)
      .mockResolvedValueOnce({ metadata: {} as never, bytes: new TextEncoder().encode('fine') })
      .mockRejectedValueOnce(new Error('wrong key'));

    const manifest = JSON.parse(
      await inspect(
        await run(),
        'import sys,zipfile\n' +
          'z=zipfile.ZipFile(sys.argv[1])\n' +
          'sys.stdout.write(z.read("manifest.json").decode("utf-8"))',
      ),
    );

    // An export that quietly loses entries is worse than one that admits it
    // could not read them.
    expect(manifest.count).toBe(2);
    expect(manifest.failed).toBe(1);
    const failed = manifest.memories.find((m: { error: string | null }) => m.error !== null);
    expect(failed.id).toBe('bbbbbbbb-0000-0000-0000-000000000000');
    expect(failed.file).toBeNull();
  });

  it('says so in the README too, where a person will actually look', async () => {
    vi.mocked(listThoughts).mockResolvedValue([metadata()]);
    vi.mocked(openThought).mockRejectedValue(new Error('wrong key'));

    const readme = await inspect(
      await run(),
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'sys.stdout.write(z.read("README.txt").decode("utf-8"))',
    );
    expect(readme).toMatch(/could not be decrypted/i);
  });
});

describe('the README', () => {
  it('warns that the archive itself is not encrypted', async () => {
    vi.mocked(listThoughts).mockResolvedValue([]);

    const readme = await inspect(
      await run(),
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'sys.stdout.write(z.read("README.txt").decode("utf-8"))',
    );
    // Handing someone their whole diary in the clear without saying so would
    // undo the point of everything upstream of it.
    expect(readme).toMatch(/NOT encrypted/);
    expect(readme).toMatch(/store it the way you would store a paper diary/i);
  });
});

describe('progress', () => {
  it('reports as it goes, since decrypting a full vault is not instant', async () => {
    vi.mocked(listThoughts).mockResolvedValue([metadata(), metadata(), metadata()]);
    vi.mocked(openThought).mockResolvedValue({
      metadata: {} as never,
      bytes: new TextEncoder().encode('x'),
    });

    const seen: number[] = [];
    await exportVault({
      token: 'token',
      key: vault.vaultKey,
      onProgress: (p) => seen.push(p.completed),
    });

    expect(seen).toEqual([1, 2, 3]);
  });
});
