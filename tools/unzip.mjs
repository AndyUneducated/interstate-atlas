// Minimal ZIP reader: enough to pull selected entries out of a local archive.
//
// The Canadian source archives are large (Ontario is 417 MB) and each one holds
// an English and a French copy of the same shapefiles, so extracting
// everything would double the disk cost for nothing. Reading the central
// directory lets the caller pick entries by name and inflate only those.
//
// Written by hand rather than taken as a dependency because the requirement is
// narrow: stored and deflated entries in a seekable local file. Zip64 is
// handled because these archives cross the 4 GB uncompressed mark.

import { open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CD_SIG = 0x02014b50;

async function readAt(fh, length, position) {
  const buf = Buffer.allocUnsafe(length);
  await fh.read(buf, 0, length, position);
  return buf;
}

/** Locate the end-of-central-directory record by scanning back from the tail. */
async function findEocd(fh, size) {
  const tailLen = Math.min(size, 0xffff + 22);
  const tail = await readAt(fh, tailLen, size - tailLen);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    let entries = tail.readUInt16LE(i + 10);
    let cdSize = tail.readUInt32LE(i + 12);
    let cdOffset = tail.readUInt32LE(i + 16);

    // A Zip64 archive parks sentinel values in the classic record and keeps the
    // real ones in a separate header pointed at by a locator just before it.
    if (cdOffset === 0xffffffff || entries === 0xffff || cdSize === 0xffffffff) {
      const locOff = i - 20;
      if (locOff >= 0 && tail.readUInt32LE(locOff) === EOCD64_LOC_SIG) {
        const eocd64At = Number(tail.readBigUInt64LE(locOff + 8));
        const h = await readAt(fh, 56, eocd64At);
        if (h.readUInt32LE(0) === EOCD64_SIG) {
          entries = Number(h.readBigUInt64LE(32));
          cdSize = Number(h.readBigUInt64LE(40));
          cdOffset = Number(h.readBigUInt64LE(48));
        }
      }
    }
    return { entries, cdSize, cdOffset };
  }
  throw new Error('not a zip archive: no end-of-central-directory record');
}

/** List every entry in the archive as { name, method, size, localOffset }. */
export async function listEntries(path) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const { entries, cdSize, cdOffset } = await findEocd(fh, size);
    const cd = await readAt(fh, cdSize, cdOffset);
    const out = [];
    let p = 0;
    for (let n = 0; n < entries && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== CD_SIG) break;
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let uncompSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);

      // Oversized fields are moved into a Zip64 extended-information block,
      // which lists only the fields that actually overflowed, in a fixed order.
      if (uncompSize === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) {
        const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
        for (let e = 0; e + 4 <= extra.length;) {
          const id = extra.readUInt16LE(e);
          const len = extra.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (uncompSize === 0xffffffff) { uncompSize = Number(extra.readBigUInt64LE(q)); q += 8; }
            if (compSize === 0xffffffff) { compSize = Number(extra.readBigUInt64LE(q)); q += 8; }
            if (localOffset === 0xffffffff) { localOffset = Number(extra.readBigUInt64LE(q)); }
            break;
          }
          e += 4 + len;
        }
      }
      out.push({ name, method, compSize, size: uncompSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/**
 * Extract one entry to `dest`.
 *
 * The central directory's name and extra-field lengths can disagree with the
 * local header's, so the payload offset is taken from the local header.
 */
export async function extractEntry(path, entry, dest) {
  const fh = await open(path, 'r');
  try {
    const head = await readAt(fh, 30, entry.localOffset);
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    const start = entry.localOffset + 30 + nameLen + extraLen;
    const source = fh.createReadStream({ start, end: start + entry.compSize - 1, autoClose: false });
    const stages = entry.method === 0
      ? [source, createWriteStream(dest)]
      : [source, createInflateRaw(), createWriteStream(dest)];
    await pipeline(...stages);
  } finally {
    await fh.close();
  }
}

export { Readable };
