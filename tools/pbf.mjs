// A reader for OpenStreetMap's PBF format, enough of it to pull roads out of a
// country extract without a dependency.
//
// A PBF file is a run of blobs, each a zlib-compressed block of nodes, ways or
// relations with its own string table. Extracts are sorted nodes first, then
// ways, then relations, so a reader that needs ways' coordinates reads the
// ways first, notes the node ids it needs, and reads the nodes after.
//
// Protocol buffers are decoded by hand. Ids pass 2^32, so varints are
// accumulated as doubles rather than with bitwise operators, which are 32-bit
// in JavaScript; every id and coordinate in OSM is well inside 2^53.

import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

class Reader {
  constructor(buf, start = 0, end = buf.length) { this.b = buf; this.p = start; this.end = end; }
  more() { return this.p < this.end; }
  varint() {
    const b = this.b;
    let v = 0, mul = 1, x;
    do { x = b[this.p++]; v += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80);
    return v;
  }
  key() { const k = this.varint(); return [Math.floor(k / 8), k & 7]; }
  bytes() { const n = this.varint(); const s = this.p; this.p += n; return [s, this.p]; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 2) { const n = this.varint(); this.p += n; }
    else if (wire === 1) this.p += 8;
    else if (wire === 5) this.p += 4;
    else throw new Error(`pbf: wire type ${wire}`);
  }
}

const zig = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

function packed(buf, [s, e], signedDelta = false) {
  const r = new Reader(buf, s, e);
  const out = [];
  let acc = 0;
  while (r.more()) {
    const v = r.varint();
    if (signedDelta) { acc += zig(v); out.push(acc); } else out.push(v);
  }
  return out;
}

/** Every blob in the file: its type and where its bytes lie, without reading them. */
export async function blobs(path) {
  const fh = await open(path, 'r');
  const out = [];
  const head = Buffer.alloc(4);
  let pos = 0;
  try {
    for (;;) {
      const { bytesRead } = await fh.read(head, 0, 4, pos);
      if (bytesRead < 4) break;
      const hlen = head.readUInt32BE(0);
      const hb = Buffer.alloc(hlen);
      await fh.read(hb, 0, hlen, pos + 4);
      const r = new Reader(hb);
      let type = '', size = 0;
      while (r.more()) {
        const [f, w] = r.key();
        if (f === 1) { const [s, e] = r.bytes(); type = hb.toString('utf8', s, e); } else if (f === 3) size = r.varint();
        else r.skip(w);
      }
      out.push({ type, offset: pos + 4 + hlen, size });
      pos += 4 + hlen + size;
    }
  } finally { await fh.close(); }
  return out;
}

/** The decompressed bytes of one blob. */
export async function readBlob(fh, blob) {
  const raw = Buffer.alloc(blob.size);
  await fh.read(raw, 0, blob.size, blob.offset);
  const r = new Reader(raw);
  while (r.more()) {
    const [f, w] = r.key();
    if (f === 1) { const [s, e] = r.bytes(); return raw.subarray(s, e); }
    if (f === 3) { const [s, e] = r.bytes(); return inflateSync(raw.subarray(s, e)); }
    if (f === 4 || f === 6 || f === 7) throw new Error('pbf: only zlib-compressed blobs are supported');
    r.skip(w);
  }
  return Buffer.alloc(0);
}

/** The header block's replication timestamp, which dates the extract. */
export function headerTimestamp(buf) {
  const r = new Reader(buf);
  while (r.more()) {
    const [f, w] = r.key();
    if (f === 32) return r.varint();
    r.skip(w);
  }
  return null;
}

/**
 * Walk one primitive block, calling back for what was asked for.
 *
 * `on.way(id, tags, refs)`, `on.relation(id, tags, members)` and
 * `on.nodes(ids, lons, lats, tagsAt)` are each optional, and a group of a kind
 * nobody asked for is skipped without being decoded. `tagsAt(i)` decodes the
 * tags of the i-th dense node only when called.
 */
export function walkBlock(buf, on) {
  const r = new Reader(buf);
  let st = null;
  const groups = [];
  let gran = 100, latOff = 0, lonOff = 0;
  while (r.more()) {
    const [f, w] = r.key();
    if (f === 1) {
      const [s, e] = r.bytes();
      const sr = new Reader(buf, s, e);
      st = [];
      while (sr.more()) {
        const [ff, ww] = sr.key();
        if (ff === 1) { const [a, b] = sr.bytes(); st.push(buf.toString('utf8', a, b)); } else sr.skip(ww);
      }
    } else if (f === 2) groups.push(r.bytes());
    else if (f === 17) gran = r.varint();
    else if (f === 19) latOff = zig(r.varint());
    else if (f === 20) lonOff = zig(r.varint());
    else r.skip(w);
  }
  const tagsOf = (keys, vals) => {
    const t = {};
    for (let i = 0; i < keys.length; i++) t[st[keys[i]]] = st[vals[i]];
    return t;
  };
  for (const [gs, ge] of groups) {
    const g = new Reader(buf, gs, ge);
    while (g.more()) {
      const [f, w] = g.key();
      if (f === 2 && on.nodes) {
        const [s, e] = g.bytes();
        const d = new Reader(buf, s, e);
        let ids = [], lats = [], lons = [], kv = null;
        while (d.more()) {
          const [ff, ww] = d.key();
          if (ff === 1) ids = packed(buf, d.bytes(), true);
          else if (ff === 8) lats = packed(buf, d.bytes(), true);
          else if (ff === 9) lons = packed(buf, d.bytes(), true);
          else if (ff === 10) kv = d.bytes();
          else d.skip(ww);
        }
        const toDeg = (v, off) => (off + gran * v) * 1e-9;
        for (let i = 0; i < ids.length; i++) { lats[i] = toDeg(lats[i], latOff); lons[i] = toDeg(lons[i], lonOff); }
        // keys_vals is one flat run with a 0 after each node's pairs; index it
        // only when somebody asks for a node's tags.
        let starts = null;
        const tagsAt = (i) => {
          if (!kv) return null;
          if (!starts) {
            starts = new Int32Array(ids.length + 1);
            const all = packed(buf, kv);
            starts.all = all;
            let n = 0;
            starts[0] = 0;
            for (let j = 0; j < all.length && n < ids.length; j++) if (all[j] === 0) starts[++n] = j + 1;
          }
          const all = starts.all;
          const t = {};
          for (let j = starts[i]; j < all.length && all[j] !== 0; j += 2) t[st[all[j]]] = st[all[j + 1]];
          return t;
        };
        on.nodes(ids, lons, lats, tagsAt);
      } else if (f === 3 && on.way) {
        const [s, e] = g.bytes();
        const wr = new Reader(buf, s, e);
        let id = 0, keys = [], vals = [], refs = null;
        while (wr.more()) {
          const [ff, ww] = wr.key();
          if (ff === 1) id = wr.varint();
          else if (ff === 2) keys = packed(buf, wr.bytes());
          else if (ff === 3) vals = packed(buf, wr.bytes());
          else if (ff === 8) refs = wr.bytes();
          else wr.skip(ww);
        }
        const tags = tagsOf(keys, vals);
        on.way(id, tags, () => (refs ? packed(buf, refs, true) : []));
      } else if (f === 4 && on.relation) {
        const [s, e] = g.bytes();
        const rr = new Reader(buf, s, e);
        let id = 0, keys = [], vals = [], roles = [], mem = [], types = [];
        while (rr.more()) {
          const [ff, ww] = rr.key();
          if (ff === 1) id = rr.varint();
          else if (ff === 2) keys = packed(buf, rr.bytes());
          else if (ff === 3) vals = packed(buf, rr.bytes());
          else if (ff === 8) roles = packed(buf, rr.bytes());
          else if (ff === 9) mem = packed(buf, rr.bytes(), true);
          else if (ff === 10) types = packed(buf, rr.bytes());
          else rr.skip(ww);
        }
        const tags = tagsOf(keys, vals);
        on.relation(id, tags, () => mem.map((m, i) => ({ id: m, type: types[i], role: st[roles[i]] })));
      } else g.skip(w);
    }
  }
}

/** What kinds of group a block holds, read from the group headers alone. */
export function kindsOf(buf) {
  const r = new Reader(buf);
  const kinds = new Set();
  while (r.more()) {
    const [f, w] = r.key();
    if (f !== 2) { r.skip(w); continue; }
    const [s, e] = r.bytes();
    const g = new Reader(buf, s, e);
    while (g.more()) {
      const [ff, ww] = g.key();
      kinds.add(ff === 1 || ff === 2 ? 'node' : ff === 3 ? 'way' : ff === 4 ? 'relation' : 'other');
      g.skip(ww);
    }
  }
  return kinds;
}
