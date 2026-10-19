/* WX Studio – minimal MP4 muxer (H.264 video + optional AAC audio, fast-start: moov before mdat).
 * Video input is what WebCodecs' VideoEncoder produces: AVCC length-prefixed samples + an avcC description.
 * Audio input is what WebCodecs' AudioEncoder produces for AAC-LC: raw AAC frames + an AudioSpecificConfig.
 * Output plays on X (Twitter), Facebook, Instagram, YouTube, QuickTime and Windows Media Player.
 * v0.10.0: tracks are generic so audio can be added without touching the video path; the video track is tagged
 * BT.709 (colr 'nclx', limited range) and square-pixel (pasp 1:1). Video-only use is unchanged:
 *   const w = new Mp4Writer(1920, 1080); w.setDescription(avcC); w.addSample(bytes, tsUs, durUs, isKey); w.finalize()
 * Audio:  w.addAudioTrack({ sampleRate: 48000, channels: 2, description: asc, bitrate: 192000, primingSamples: 1024 });
 *         w.addAudioSample(bytes, tsUs, durUs)                                                                       */
(function (g) {
  'use strict';
  const enc = new TextEncoder();
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u24 = n => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = n => [(n >>> 8) & 255, n & 255];
  const cat = parts => { let n = 0; parts.forEach(p => n += p.length); const o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; };
  const box = (type, ...kids) => { const body = cat(kids.map(k => k instanceof Uint8Array ? k : Uint8Array.from(k))); return cat([Uint8Array.from(u32(body.length + 8)), enc.encode(type), body]); };
  const fullbox = (type, ver, flags, ...kids) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...kids);
  const zeros = n => new Uint8Array(n);
  const MATRIX = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];
  const TS = 90000;           // video timescale
  const MOVIE_TS = 1000;      // movie (mvhd) timescale
  const BT709 = { primaries: 1, transfer: 1, matrix: 1, fullRange: false };

  /* One sample list -> stts run-length entries, per-sample durations and total ticks, in the track's timescale. */
  function timing(samples, timescale, defaultDurTicks) {
    const n = samples.length, ticks = samples.map(s => Math.round(s.tsUs * timescale / 1e6));
    const dur = samples.map((s, i) => i + 1 < n ? Math.max(1, ticks[i + 1] - ticks[i]) : Math.max(1, s.durUs ? Math.round(s.durUs * timescale / 1e6) : defaultDurTicks));
    const total = dur.reduce((a, b) => a + b, 0), stts = []; let i = 0;
    while (i < n) { let j = i; while (j < n && dur[j] === dur[i]) j++; stts.push([j - i, dur[i]]); i = j; }
    return { dur, total, stts };
  }
  const sttsBox = stts => fullbox('stts', 0, 0, u32(stts.length), ...stts.map(e => cat([Uint8Array.from(u32(e[0])), Uint8Array.from(u32(e[1]))])));
  const stszBox = S => fullbox('stsz', 0, 0, u32(0), u32(S.length), ...S.map(s => Uint8Array.from(u32(s.data.length))));
  const stcoBox = offsets => fullbox('stco', 0, 0, u32(offsets.length), ...offsets.map(o => Uint8Array.from(u32(o))));
  const stscBox = () => fullbox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));   // one sample per chunk (keeps audio and video interleaved)
  const dinf = () => box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));

  function esds(asc, bitrate, channels) {
    const dsi = [0x05, asc.length, ...asc];
    const dec = [0x04, 13 + dsi.length, 0x40, 0x15, ...u24(6144 * Math.max(1, channels)), ...u32(bitrate || 0), ...u32(bitrate || 0), ...dsi];
    const es = [0x03, 3 + dec.length + 3, 0x00, 0x00, 0x00, ...dec, 0x06, 0x01, 0x02];
    return fullbox('esds', 0, 0, es);
  }

  class Mp4Writer {
    constructor(w, h, opts) {
      this.w = w; this.h = h; this.samples = []; this.avcC = null; this.audio = null;
      opts = opts || {}; this.color = opts.color === undefined ? Object.assign({}, BT709) : opts.color;   // opts.color === false -> untagged
    }
    setDescription(buf) { this.avcC = new Uint8Array(buf.buffer ? new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength) : buf); }
    addSample(data, tsUs, durUs, key) { this.samples.push({ data: data instanceof Uint8Array ? data : new Uint8Array(data), tsUs, durUs, key: !!key }); }
    setColor(c) { this.color = c; }
    addAudioTrack(o) {
      const d = o.description; if (!d) throw new Error('AAC audio needs an AudioSpecificConfig description');
      const asc = new Uint8Array(d.buffer ? new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength) : d);
      this.audio = { sampleRate: o.sampleRate || 48000, channels: o.channels || 2, asc, bitrate: o.bitrate || 0, priming: o.primingSamples || 0, samples: [] };
    }
    addAudioSample(data, tsUs, durUs) {
      if (!this.audio) throw new Error('call addAudioTrack first');
      this.audio.samples.push({ data: data instanceof Uint8Array ? data : new Uint8Array(data), tsUs, durUs, key: true });
    }

    _videoTrak(offsets, id) {
      const S = this.samples, tm = timing(S, TS, Math.round(TS / 30)), totalMs = Math.round(tm.total * MOVIE_TS / TS);
      const keys = []; S.forEach((s, k) => { if (s.key) keys.push(k + 1); });
      const c = this.color, kids = [box('avcC', this.avcC), box('pasp', u32(1), u32(1))];
      if (c) kids.push(box('colr', enc.encode('nclx'), u16(c.primaries), u16(c.transfer), u16(c.matrix), [c.fullRange ? 0x80 : 0]));
      const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(this.w), u16(this.h), u32(0x00480000), u32(0x00480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), ...kids);
      const stbl = box('stbl', fullbox('stsd', 0, 0, u32(1), avc1), sttsBox(tm.stts),
        keys.length ? fullbox('stss', 0, 0, u32(keys.length), ...keys.map(k => Uint8Array.from(u32(k)))) : new Uint8Array(0),
        stscBox(), stszBox(S), stcoBox(offsets));
      const minf = box('minf', fullbox('vmhd', 0, 1, u16(0), zeros(6)), dinf(), stbl);
      const mdia = box('mdia', fullbox('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(tm.total), u16(0x55c4), u16(0)), fullbox('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')), minf);
      return { ms: totalMs, trak: box('trak', fullbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(totalMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(this.w << 16), u32(this.h << 16)), mdia) };
    }
    _audioTrak(offsets, id) {
      const A = this.audio, S = A.samples, tm = timing(S, A.sampleRate, 1024), totalMs = Math.round(Math.max(0, tm.total - A.priming) * MOVIE_TS / A.sampleRate);
      const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(A.channels), u16(16), u16(0), u16(0), u32((A.sampleRate & 0xffff) << 16), esds(A.asc, A.bitrate, A.channels));
      const stbl = box('stbl', fullbox('stsd', 0, 0, u32(1), mp4a), sttsBox(tm.stts), stscBox(), stszBox(S), stcoBox(offsets));
      const minf = box('minf', fullbox('smhd', 0, 0, u16(0), u16(0)), dinf(), stbl);
      const mdia = box('mdia', fullbox('mdhd', 0, 0, u32(0), u32(0), u32(A.sampleRate), u32(tm.total), u16(0x55c4), u16(0)), fullbox('hdlr', 0, 0, u32(0), enc.encode('soun'), zeros(12), enc.encode('SoundHandler\0')), minf);
      // The AAC encoder's first frames are priming (encoder delay); an edit list tells players to skip them so sound lines up with picture.
      const edts = A.priming > 0 ? box('edts', fullbox('elst', 0, 0, u32(1), u32(totalMs), u32(A.priming), u16(1), u16(0))) : new Uint8Array(0);
      return { ms: totalMs, trak: box('trak', fullbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(totalMs), zeros(8), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)), edts, mdia) };
    }
    _moov(vOff, aOff) {
      const v = this._videoTrak(vOff, 1), parts = [v.trak]; let ms = v.ms, next = 2;
      if (this.audio && this.audio.samples.length) { const a = this._audioTrak(aOff, 2); parts.push(a.trak); ms = Math.max(ms, a.ms); next = 3; }
      return box('moov', fullbox('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE_TS), u32(ms), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(next)), ...parts);
    }
    finalize() {
      if (!this.avcC) throw new Error('missing avcC description');
      const hasA = !!(this.audio && this.audio.samples.length), V = this.samples, A = hasA ? this.audio.samples : [];
      const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isom'), enc.encode('iso2'), enc.encode('avc1'), enc.encode('mp41'));
      // mdat order: every sample sorted by time (audio before video on ties) so players can stream both without seeking.
      const order = []; V.forEach((s, i) => order.push({ t: s.tsUs, k: 1, i })); A.forEach((s, i) => order.push({ t: s.tsUs, k: 0, i }));
      order.sort((a, b) => a.t - b.t || a.k - b.k || a.i - b.i);
      const total = V.reduce((a, s) => a + s.data.length, 0) + A.reduce((a, s) => a + s.data.length, 0);
      const zV = new Array(V.length).fill(0), zA = new Array(A.length).fill(0), moovLen = this._moov(zV, zA).length;
      let pos = ftyp.length + moovLen + 8; if (pos + total > 0xFFFFFFFF) throw new Error('This show is too large for a single MP4 file – lower the quality or shorten it.');
      const vOff = new Array(V.length), aOff = new Array(A.length);
      order.forEach(e => { const s = e.k ? V[e.i] : A[e.i]; (e.k ? vOff : aOff)[e.i] = pos; pos += s.data.length; });
      const moov = this._moov(vOff, aOff), mdatHdr = cat([Uint8Array.from(u32(total + 8)), enc.encode('mdat')]);
      return cat([ftyp, moov, mdatHdr, ...order.map(e => e.k ? V[e.i].data : A[e.i].data)]);
    }
  }
  Mp4Writer.BT709 = BT709;
  g.Mp4Writer = Mp4Writer;
  if (typeof module !== 'undefined') module.exports = { Mp4Writer };
})(typeof window !== 'undefined' ? window : globalThis);
