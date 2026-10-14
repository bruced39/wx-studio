/* WX Studio – minimal H.264 MP4 muxer (video only, fast-start: moov before mdat).
 * Input is what WebCodecs' VideoEncoder produces: AVCC length-prefixed samples + an avcC description.
 * Output plays on X (Twitter), Facebook, Instagram, YouTube, QuickTime and Windows Media Player.        */
(function (g) {
  'use strict';
  const enc = new TextEncoder();
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = n => [(n >>> 8) & 255, n & 255];
  const cat = parts => { let n = 0; parts.forEach(p => n += p.length); const o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; };
  const box = (type, ...kids) => { const body = cat(kids.map(k => k instanceof Uint8Array ? k : Uint8Array.from(k))); return cat([Uint8Array.from(u32(body.length + 8)), enc.encode(type), body]); };
  const fullbox = (type, ver, flags, ...kids) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...kids);
  const zeros = n => new Uint8Array(n);
  const MATRIX = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];
  const TS = 90000;

  class Mp4Writer {
    constructor(w, h) { this.w = w; this.h = h; this.samples = []; this.avcC = null; }
    setDescription(buf) { this.avcC = new Uint8Array(buf.buffer ? new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength) : buf); }
    addSample(data, tsUs, durUs, key) { this.samples.push({ data: data instanceof Uint8Array ? data : new Uint8Array(data), tsUs, durUs, key: !!key }); }
    _moov(offsets) {
      const S = this.samples, n = S.length, ticks = S.map(s => Math.round(s.tsUs * TS / 1e6));
      const dur = S.map((s, i) => i + 1 < n ? Math.max(1, ticks[i + 1] - ticks[i]) : Math.max(1, Math.round(s.durUs * TS / 1e6)));
      const totalTicks = dur.reduce((a, b) => a + b, 0), totalMs = Math.round(totalTicks * 1000 / TS);
      const stts = []; let i = 0; while (i < n) { let j = i; while (j < n && dur[j] === dur[i]) j++; stts.push([j - i, dur[i]]); i = j; }
      const keys = []; S.forEach((s, k) => { if (s.key) keys.push(k + 1); });
      const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(this.w), u16(this.h), u32(0x00480000), u32(0x00480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', this.avcC));
      const stbl = box('stbl',
        fullbox('stsd', 0, 0, u32(1), avc1),
        fullbox('stts', 0, 0, u32(stts.length), ...stts.map(e => cat([Uint8Array.from(u32(e[0])), Uint8Array.from(u32(e[1]))]))),
        keys.length ? fullbox('stss', 0, 0, u32(keys.length), ...keys.map(k => Uint8Array.from(u32(k)))) : new Uint8Array(0),
        fullbox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
        fullbox('stsz', 0, 0, u32(0), u32(n), ...S.map(s => Uint8Array.from(u32(s.data.length)))),
        fullbox('stco', 0, 0, u32(n), ...offsets.map(o => Uint8Array.from(u32(o)))));
      const minf = box('minf', fullbox('vmhd', 0, 1, u16(0), zeros(6)), box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1))), stbl);
      const mdia = box('mdia', fullbox('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(totalTicks), u16(0x55c4), u16(0)), fullbox('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')), minf);
      const trak = box('trak', fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(totalMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(this.w << 16), u32(this.h << 16)), mdia);
      return box('moov', fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(totalMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)), trak);
    }
    finalize() {
      if (!this.avcC) throw new Error('missing avcC description');
      const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isom'), enc.encode('iso2'), enc.encode('avc1'), enc.encode('mp41'));
      const n = this.samples.length, total = this.samples.reduce((a, s) => a + s.data.length, 0);
      const zeroOff = new Array(n).fill(0), moovLen = this._moov(zeroOff).length;
      let pos = ftyp.length + moovLen + 8; const offsets = this.samples.map(s => { const o = pos; pos += s.data.length; return o; });
      const moov = this._moov(offsets), mdatHdr = cat([Uint8Array.from(u32(total + 8)), enc.encode('mdat')]);
      return cat([ftyp, moov, mdatHdr, ...this.samples.map(s => s.data)]);
    }
  }
  g.Mp4Writer = Mp4Writer;
  if (typeof module !== 'undefined') module.exports = { Mp4Writer };
})(typeof window !== 'undefined' ? window : globalThis);
