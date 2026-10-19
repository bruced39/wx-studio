'use strict';
/* Test helpers: make small H.264 / AAC streams with ffmpeg and cut them into the sample shapes WebCodecs produces. */
const { spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const have = bin => { try { return spawnSync(bin, ['-version']).status === 0; } catch (e) { return false; } };
const haveFfmpeg = () => have('ffmpeg') && have('ffprobe');
const tmp = name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wxmp4-')), name);
const run = (bin, args) => { const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 << 20 }); return r; };

/* Annex-B H.264 -> { avcC, samples:[{data(AVCC),key}] } */
function h264Samples(w, h, fps, seconds) {
  const f = tmp('t.h264'); const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}`, '-t', String(seconds), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(fps * 2), '-bf', '0', '-b:v', '4M', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', f]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  const d = fs.readFileSync(f), idx = [];
  for (let p = 0; p < d.length - 3; p++) if (d[p] === 0 && d[p + 1] === 0 && (d[p + 2] === 1 || (d[p + 2] === 0 && d[p + 3] === 1))) { const sc = d[p + 2] === 1 ? 3 : 4; idx.push([p, sc]); p += sc - 1; }
  const nals = idx.map(([p, sc], k) => d.subarray(p + sc, k + 1 < idx.length ? idx[k + 1][0] : d.length));
  let sps, pps; const samples = []; let cur = [], key = false;
  const flush = () => { if (!cur.length) return; const parts = []; cur.forEach(n => { const l = Buffer.alloc(4); l.writeUInt32BE(n.length); parts.push(l, n); }); samples.push({ data: new Uint8Array(Buffer.concat(parts)), key }); cur = []; key = false; };
  for (const n of nals) {
    const t = n[0] & 31; if (t === 7) { sps = n; continue; } if (t === 8) { pps = n; continue; } if (t === 9) continue;
    if ((t === 1 || t === 5) && (n[1] & 0x80) && cur.some(x => { const u = x[0] & 31; return u === 1 || u === 5; })) flush();
    if (t === 5) key = true; cur.push(n);
  }
  flush();
  const avcC = new Uint8Array(Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xFF, 0xE1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]));
  return { avcC, samples };
}

/* ADTS AAC-LC -> { asc, frames:[Uint8Array raw AAC], sampleRate, channels } */
function aacFrames(seconds, freq) {
  const f = tmp('t.aac'); const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq || 440}:sample_rate=48000`, '-t', String(seconds), '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-f', 'adts', f]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  const d = fs.readFileSync(f), frames = []; let p = 0, asc = null, sr = 48000, ch = 2;
  const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  while (p + 7 <= d.length && d[p] === 0xFF && (d[p + 1] & 0xF0) === 0xF0) {
    const prot = d[p + 1] & 1, obj = ((d[p + 2] >> 6) & 3) + 1, sfi = (d[p + 2] >> 2) & 15, cfg = ((d[p + 2] & 1) << 2) | (d[p + 3] >> 6), len = ((d[p + 3] & 3) << 11) | (d[p + 4] << 3) | (d[p + 5] >> 5), hdr = prot ? 7 : 9;
    if (!asc) { const v = (obj << 11) | (sfi << 7) | (cfg << 3); asc = new Uint8Array([v >> 8, v & 255]); sr = SR[sfi]; ch = cfg; }
    frames.push(new Uint8Array(d.subarray(p + hdr, p + len))); p += len;
  }
  return { asc, frames, sampleRate: sr, channels: ch };
}

const probe = (file, extra) => { const r = run('ffprobe', ['-v', 'error', '-of', 'json', '-show_streams', '-show_format', ...(extra || []), file]); if (r.status !== 0) throw new Error('ffprobe failed: ' + r.stderr); return JSON.parse(r.stdout); };
const decodeErrors = file => run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']).stderr.trim();
const writeTmp = (name, bytes) => { const f = tmp(name); fs.writeFileSync(f, Buffer.from(bytes)); return f; };
module.exports = { haveFfmpeg, h264Samples, aacFrames, probe, decodeErrors, writeTmp, run, tmp };
