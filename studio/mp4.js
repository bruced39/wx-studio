/* WX Studio – minimal MP4 muxer (H.264 video + optional AAC audio, fast-start: moov before mdat).
 * Video input is what WebCodecs' VideoEncoder produces: AVCC length-prefixed samples + an avcC description.
 * Audio input is what WebCodecs' AudioEncoder produces for AAC-LC: raw AAC frames + an AudioSpecificConfig.
 * Output plays on X (Twitter), Facebook, Instagram, YouTube, QuickTime and Windows Media Player.
 * v0.10.0: tracks are generic so audio can be added without touching the video path; the video track is tagged
 * BT.709 (colr 'nclx', limited range) and square-pixel (pasp 1:1). Video-only use is unchanged:
 *   const w = new Mp4Writer(1920, 1080); w.setDescription(avcC); w.addSample(bytes, tsUs, durUs, isKey); w.finalize()
 * v0.10.1.6: the video path now copes with what real hardware/software encoders emit: (a) B-frames – chunks arrive in decode
 *   order with presentation timestamps, so the track gets proper decode times (stts), composition offsets (ctts) and an edit
 *   list; (b) in-band parameter sets/access-unit delimiters are removed from the samples and the avcC is rebuilt from the SPS/PPS
 *   (some encoders hand over a malformed avcC); streams with monotonic timestamps still produce exactly the old boxes.
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

  /* ---- H.264 helpers: NAL splitting, SPS parsing and avcC building --------------------------------------------------------- */
  const HIGH = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
  const PROFILES = new Set([66, 77, 88, 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
  const hex = u => Array.prototype.map.call(u, b => (b < 16 ? '0' : '') + b.toString(16)).join('');
  function splitNals(data, lsz) {                       // length-prefixed sample -> array of NAL units, or null if it does not parse exactly
    const out = []; let p = 0;
    while (p < data.length) {
      if (p + lsz > data.length) return null;
      let L = 0; for (let k = 0; k < lsz; k++) L = L * 256 + data[p + k];
      p += lsz; if (L <= 0 || p + L > data.length) return null;
      out.push(data.subarray(p, p + L)); p += L;
    }
    return out;
  }
  const joinNals = nals => { const parts = []; nals.forEach(n => { parts.push(Uint8Array.from(u32(n.length)), n); }); return cat(parts); };
  function unescape(b) { const o = []; for (let i = 0; i < b.length; i++) { if (i >= 2 && b[i] === 3 && b[i - 1] === 0 && b[i - 2] === 0) continue; o.push(b[i]); } return Uint8Array.from(o); }
  function spsInfo(sps) {                               // profile / constraint flags / level, plus chroma format and bit depths for High profiles
    const info = { profile: sps[1], compat: sps[2], level: sps[3], chroma: 1, bdL: 8, bdC: 8 };
    if (!HIGH.has(sps[1])) return info;
    try {
      const b = unescape(sps.subarray(1)); let pos = 24;
      const bit = () => { if ((pos >> 3) >= b.length) throw new Error('eof'); const v = (b[pos >> 3] >> (7 - (pos & 7))) & 1; pos++; return v; };
      const ue = () => { let z = 0; while (!bit()) { if (++z > 31) throw new Error('bad'); } let v = 0; for (let i = 0; i < z; i++) v = v * 2 + bit(); return Math.pow(2, z) - 1 + v; };
      ue(); info.chroma = ue(); if (info.chroma === 3) bit(); info.bdL = ue() + 8; info.bdC = ue() + 8;
      if (info.chroma > 3 || info.bdL > 14 || info.bdC > 14) throw new Error('bad');
    } catch (e) { info.chroma = 1; info.bdL = 8; info.bdC = 8; }
    return info;
  }
  const validSps = s => !!s && s.length >= 4 && (s[0] & 31) === 7 && PROFILES.has(s[1]);
  const validPps = s => !!s && s.length >= 2 && (s[0] & 31) === 8;
  function buildAvcC(spsList, ppsList) {
    const i = spsInfo(spsList[0]), parts = [Uint8Array.from([1, i.profile, i.compat, i.level, 0xFF, 0xE0 | spsList.length])];
    spsList.forEach(s => { parts.push(Uint8Array.from(u16(s.length)), s); });
    parts.push(Uint8Array.from([ppsList.length])); ppsList.forEach(s => { parts.push(Uint8Array.from(u16(s.length)), s); });
    if (HIGH.has(i.profile)) parts.push(Uint8Array.from([0xFC | i.chroma, 0xF8 | (i.bdL - 8), 0xF8 | (i.bdC - 8), 0]));
    return cat(parts);
  }
  /* Tolerant avcC reader: finds the SPS/PPS even if the reserved bits are wrong; repairs a doubled NAL header byte (67 67 64 … / 68 68 …). */
  function readAvcC(d) {
    if (!d || d.length < 9) return null;
    let p = 5; const n = d[p++] & 31, sps = [], pps = [];
    const take = list => { if (p + 2 > d.length) return false; const L = (d[p] << 8) | d[p + 1]; p += 2; if (L < 2 || p + L > d.length) return false; list.push(d.subarray(p, p + L)); p += L; return true; };
    for (let k = 0; k < n; k++) if (!take(sps)) return null;
    if (p >= d.length) return null;
    const m = d[p++]; for (let k = 0; k < m; k++) if (!take(pps)) return null;
    const fix = (s, t) => (s.length > 4 && (s[0] & 31) === t && s[1] === s[0]) ? s.subarray(1) : s;
    const S = sps.map(s => fix(s, 7)), P = pps.map(s => fix(s, 8));
    return S.length && P.length && S.every(validSps) && P.every(validPps) ? { sps: S, pps: P } : null;
  }
  const isCleanAvcC = d => !!d && d.length >= 9 && d[0] === 1 && (d[4] & 0xFC) === 0xFC && (d[5] & 0xE0) === 0xE0;

  /* Video sample list -> decode times, composition offsets and stts/ctts runs, in the track's timescale.
   * Chunks arrive in DECODE order carrying PRESENTATION timestamps. With B-frames those are not increasing, so decode times are
   * taken from the sorted presentation times (the n-th decoded frame is decoded when the n-th earliest frame is due), moved earlier
   * by `shift` so that no composition offset is negative; an edit list then skips `shift` so the first frame still shows at 0.   */
  function videoTiming(S, defaultDur) {
    const n = S.length, pts = S.map(s => Math.round(s.tsUs * TS / 1e6)), sorted = pts.slice().sort((a, b) => a - b), s0 = n ? sorted[0] : 0;
    const dts = []; for (let i = 0; i < n; i++) dts.push(i ? Math.max(dts[i - 1] + 1, sorted[i] - s0) : 0);
    let shift = 0; for (let i = 0; i < n; i++) shift = Math.max(shift, dts[i] - (pts[i] - s0));
    const cts = pts.map((t, i) => t - s0 - dts[i] + shift);
    let last = 0; for (let i = 1; i < n; i++) if (pts[i] > pts[last]) last = i;
    const lastDur = n ? Math.max(1, S[last].durUs ? Math.round(S[last].durUs * TS / 1e6) : defaultDur) : 0;
    const dur = dts.map((d, i) => i + 1 < n ? dts[i + 1] - d : lastDur), total = n ? dts[n - 1] + lastDur : 0;
    const run = a => { const r = []; let i = 0; while (i < a.length) { let j = i; while (j < a.length && a[j] === a[i]) j++; r.push([j - i, a[i]]); i = j; } return r; };
    return { dur, dts, cts, shift, s0, total, stts: run(dur), ctts: cts.some(c => c) ? run(cts) : null, reordered: shift > 0 };
  }
  const sttsBox = stts => fullbox('stts', 0, 0, u32(stts.length), ...stts.map(e => cat([Uint8Array.from(u32(e[0])), Uint8Array.from(u32(e[1]))])));
  const cttsBox = e => fullbox('ctts', 0, 0, u32(e.length), ...e.map(x => cat([Uint8Array.from(u32(x[0])), Uint8Array.from(u32(x[1]))])));
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

    /* Clean the encoder's output once: collect SPS/PPS (in-band or from the description), drop in-band SPS/PPS/AUD from the samples
     * and build a well-formed avcC. If nothing can be validated the original description and samples are used untouched. */
    _prepare() {
      if (this._prep) return this._prep;
      const S = this.samples, info = { avcC: 'as-given', strippedNals: 0, reordered: false };
      let sps = [], pps = [], cleaned = null;
      const split = S.map(x => splitNals(x.data, 4));
      if (S.length && split.every(Boolean)) {
        const seenS = new Set(), seenP = new Set(); cleaned = [];
        S.forEach((x, i) => {
          const keep = []; let dropped = 0;
          split[i].forEach(n => {
            const t = n[0] & 31;
            if (t === 7) { const h = hex(n); if (!seenS.has(h)) { seenS.add(h); sps.push(n); } dropped++; }
            else if (t === 8) { const h = hex(n); if (!seenP.has(h)) { seenP.add(h); pps.push(n); } dropped++; }
            else if (t === 9) dropped++;
            else keep.push(n);
          });
          cleaned.push(dropped && keep.length ? { data: joinNals(keep), tsUs: x.tsUs, durUs: x.durUs, key: x.key, dropped } : x);
          info.strippedNals += dropped && keep.length ? dropped : 0;
        });
      }
      let avcC = this.avcC, ok = false;
      if (sps.length && pps.length && sps.every(validSps) && pps.every(validPps)) { avcC = buildAvcC(sps, pps); info.avcC = 'built-from-stream'; ok = true; }
      else {
        const r = readAvcC(this.avcC);
        if (r) { if (isCleanAvcC(this.avcC)) info.avcC = 'as-given'; else { avcC = buildAvcC(r.sps, r.pps); info.avcC = 'repaired'; } ok = true; }
      }
      // in-band parameter sets are only removed when a valid avcC now carries them
      const samples = ok && cleaned ? cleaned : S;
      if (!ok) info.strippedNals = 0;
      const tm = videoTiming(samples, Math.round(TS / 30)); info.reordered = tm.reordered;
      this._prep = { avcC, samples, tm, info }; this.info = info;
      return this._prep;
    }
    _videoTrak(offsets, id) {
      const P = this._prepare(), S = P.samples, tm = P.tm, totalMs = Math.round(tm.total * MOVIE_TS / TS);
      const keys = []; S.forEach((s, k) => { if (s.key) keys.push(k + 1); });
      const c = this.color, kids = [box('avcC', P.avcC), box('pasp', u32(1), u32(1))];
      if (c) kids.push(box('colr', enc.encode('nclx'), u16(c.primaries), u16(c.transfer), u16(c.matrix), [c.fullRange ? 0x80 : 0]));
      const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(this.w), u16(this.h), u32(0x00480000), u32(0x00480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), ...kids);
      const stbl = box('stbl', fullbox('stsd', 0, 0, u32(1), avc1), sttsBox(tm.stts),
        tm.ctts ? cttsBox(tm.ctts) : new Uint8Array(0),
        keys.length ? fullbox('stss', 0, 0, u32(keys.length), ...keys.map(k => Uint8Array.from(u32(k)))) : new Uint8Array(0),
        stscBox(), stszBox(S), stcoBox(offsets));
      const minf = box('minf', fullbox('vmhd', 0, 1, u16(0), zeros(6)), dinf(), stbl);
      const mdia = box('mdia', fullbox('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(tm.total), u16(0x55c4), u16(0)), fullbox('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')), minf);
      // B-frames: the first decoded frame is not the first shown. The edit list skips the `shift` ticks so picture starts at time 0.
      const edts = tm.shift > 0 ? box('edts', fullbox('elst', 0, 0, u32(1), u32(totalMs), u32(tm.shift), u16(1), u16(0))) : new Uint8Array(0);
      return { ms: totalMs, trak: box('trak', fullbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(totalMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(this.w << 16), u32(this.h << 16)), edts, mdia) };
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
      const hasA = !!(this.audio && this.audio.samples.length), P = this._prepare(), V = P.samples, A = hasA ? this.audio.samples : [];
      const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isom'), enc.encode('iso2'), enc.encode('avc1'), enc.encode('mp41'));
      // mdat order: every sample sorted by time (audio before video on ties) so players can stream both without seeking.
      // Video is stored in DECODE order (what a player reads), so its sort key is the decode time, not the display time.
      const order = []; V.forEach((s, i) => order.push({ t: (P.tm.dts[i] - P.tm.shift + P.tm.s0) * 1e6 / TS, k: 1, i })); A.forEach((s, i) => order.push({ t: s.tsUs, k: 0, i }));
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
