import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZipBuilder } from './zip';

/**
 * A hand-rolled archive format is worthless unless real tools can open what it
 * produces. These tests write actual files and hand them to Python's `zipfile`,
 * an independent implementation — asserting against our own reader would only
 * prove we are consistently wrong.
 */

async function writeZip(build: (zip: ZipBuilder) => void): Promise<string> {
  const zip = new ZipBuilder();
  build(zip);
  const bytes = new Uint8Array(await zip.finish().arrayBuffer());
  const path = join(mkdtempSync(join(tmpdir(), 'unsaid-zip-')), 'export.zip');
  writeFileSync(path, bytes);
  return path;
}

/** Runs Python's zipfile against the archive and returns whatever it prints. */
function inspect(path: string, script: string): string {
  return execFileSync('python3', ['-c', script, path], { encoding: 'utf8' }).trim();
}

const encoder = new TextEncoder();

describe('ZipBuilder', () => {
  it('produces an archive Python considers valid', async () => {
    const path = await writeZip((zip) => {
      zip.add('memories/2026-08-30-abc.txt', encoder.encode('the thing I could not say'));
      zip.add('README.txt', encoder.encode('YOUR UNSAID EXPORT'));
    });

    const result = inspect(
      path,
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print("BAD" if z.testzip() else "OK")',
    );
    expect(result).toBe('OK');
  });

  it('round-trips file contents byte for byte', async () => {
    const text = 'multi\nline\ttext with unicode — मलाई भन्न मन थियो 🌙';
    const path = await writeZip((zip) => zip.add('memories/entry.txt', encoder.encode(text)));

    const result = inspect(
      path,
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'sys.stdout.write(z.read("memories/entry.txt").decode("utf-8"))',
    );
    expect(result).toBe(text);
  });

  it('preserves binary payloads unchanged', async () => {
    const audio = new Uint8Array(64 * 1024);
    crypto.getRandomValues(audio);
    const path = await writeZip((zip) => zip.add('memories/voice.webm', audio));

    const result = inspect(
      path,
      'import sys,zipfile,hashlib\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print(hashlib.sha256(z.read("memories/voice.webm")).hexdigest())',
    );

    const expected = Buffer.from(
      await crypto.subtle.digest('SHA-256', audio as BufferSource),
    ).toString('hex');
    expect(result).toBe(expected);
  });

  it('keeps directory structure and lists every entry', async () => {
    const path = await writeZip((zip) => {
      zip.add('memories/one.txt', encoder.encode('one'));
      zip.add('memories/two.txt', encoder.encode('two'));
      zip.add('manifest.json', encoder.encode('{}'));
    });

    const result = inspect(
      path,
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print(",".join(sorted(z.namelist())))',
    );
    expect(result).toBe('manifest.json,memories/one.txt,memories/two.txt');
  });

  it('computes CRCs that pass an independent integrity check', async () => {
    // testzip() verifies every entry's CRC; a wrong checksum surfaces here.
    const path = await writeZip((zip) => {
      for (let i = 0; i < 25; i += 1) {
        const bytes = new Uint8Array(i * 37 + 1);
        crypto.getRandomValues(bytes);
        zip.add(`memories/entry-${i}.bin`, bytes);
      }
    });

    const result = inspect(
      path,
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print(z.testzip() or "OK")',
    );
    expect(result).toBe('OK');
  });

  it('handles an empty vault without producing a corrupt file', async () => {
    const path = await writeZip(() => {});
    const result = inspect(
      path,
      'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(len(z.namelist()))',
    );
    expect(result).toBe('0');
  });

  it('writes an empty file without breaking the archive', async () => {
    const path = await writeZip((zip) => {
      zip.add('memories/blank.txt', new Uint8Array(0));
      zip.add('manifest.json', encoder.encode('{}'));
    });
    const result = inspect(
      path,
      'import sys,zipfile\n' +
        'z=zipfile.ZipFile(sys.argv[1])\n' +
        'print("OK" if z.testzip() is None and z.read("memories/blank.txt")==b"" else "BAD")',
    );
    expect(result).toBe('OK');
  });

  it('marks filenames as UTF-8 so non-ASCII names survive', async () => {
    const path = await writeZip((zip) => zip.add('memories/मेरो-सम्झना.txt', encoder.encode('x')));
    const result = inspect(
      path,
      'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.namelist()[0])',
    );
    expect(result).toBe('memories/मेरो-सम्झना.txt');
  });
});

describe('the archive on disk', () => {
  it('is a real zip according to the file command', async () => {
    const path = await writeZip((zip) => zip.add('a.txt', encoder.encode('hello')));
    const header = readFileSync(path).subarray(0, 4);
    // Local file header signature: PK\x03\x04.
    expect(Array.from(header)).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
