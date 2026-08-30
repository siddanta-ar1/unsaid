/**
 * A minimal store-only ZIP writer.
 *
 * Ciphertext does not compress and audio is already compressed, so deflate
 * would add a dependency for no benefit. Store-only keeps this to a few dozen
 * lines the reader can verify, in a format every operating system opens
 * natively. Split out from the export flow so it can be tested directly: a
 * hand-rolled archive format is worthless unless real tools open its output.
 */
export class ZipBuilder {
  private readonly chunks: Uint8Array[] = [];
  private readonly entries: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  private offset = 0;

  private push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.offset += bytes.length;
  }

  add(name: string, content: Uint8Array): void {
    const encodedName = new TextEncoder().encode(name);
    const crc = crc32(content);
    const offset = this.offset;

    const header = new Uint8Array(30 + encodedName.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0x0800, true); // UTF-8 filenames
    view.setUint16(8, 0, true); // stored, no compression
    view.setUint32(14, crc, true);
    view.setUint32(18, content.length, true);
    view.setUint32(22, content.length, true);
    view.setUint16(26, encodedName.length, true);
    header.set(encodedName, 30);

    this.push(header);
    this.push(content);
    this.entries.push({ name: encodedName, crc, size: content.length, offset });
  }

  finish(): Blob {
    const directoryStart = this.offset;

    for (const entry of this.entries) {
      const record = new Uint8Array(46 + entry.name.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true); // central directory header
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);
      this.push(record);
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); // end of central directory
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, this.offset - directoryStart, true);
    view.setUint32(16, directoryStart, true);
    this.push(end);

    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' });
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
