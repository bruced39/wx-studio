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


/* A REAL encoder-style stream: x264 with B-frames, read back from an ffmpeg MP4 in DECODE order with PRESENTATION timestamps –
 * exactly what WebCodecs hands to the muxer. opts.chrome adds what Chrome/Edge hardware encoders put in the samples (AUD, SPS, PPS, SEI
 * in-band) and a malformed avcC like the one in a user's unplayable export (reserved bits missing, NAL header byte doubled).
 * Returns { avcC (what the encoder "reports"), goodAvcC, samples:[{data,key,tsUs,durUs}], refFile (reference MP4), frames }.        */
function h264Reordered(w, h, fps, seconds, opts) {
  opts = opts || {};
  const f = tmp('bf_ref.mp4'), r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}`, '-t', String(seconds), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(opts.gop || fps), '-bf', String(opts.bf === undefined ? 2 : opts.bf), '-b:v', '4M', '-movflags', '+faststart', f]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  const pk = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,dts_time,pos,size,flags', '-of', 'json', f]).stdout).packets;
  const d = fs.readFileSync(f), i = d.indexOf('avcC'), L = d.readUInt32BE(i - 4), goodAvcC = new Uint8Array(d.subarray(i + 4, i - 4 + L));
  const spsLen = (goodAvcC[6] << 8) | goodAvcC[7], sps = goodAvcC.subarray(8, 8 + spsLen), ppsLen = (goodAvcC[8 + spsLen + 1] << 8) | goodAvcC[8 + spsLen + 2], pps = goodAvcC.subarray(8 + spsLen + 3, 8 + spsLen + 3 + ppsLen);
  const nal = n => { const l = Buffer.alloc(4); l.writeUInt32BE(n.length); return Buffer.concat([l, Buffer.from(n)]); };
  let avcC = goodAvcC;
  const samples = pk.map(p => {
    let data = new Uint8Array(d.subarray(Number(p.pos), Number(p.pos) + Number(p.size)));
    const key = String(p.flags).startsWith('K');
    if (opts.chrome) data = new Uint8Array(Buffer.concat([nal(Buffer.from([0x09, key ? 0x10 : 0x50])), ...(key ? [nal(sps), nal(pps), nal(Buffer.from([0x06, 0x05, 0x02, 0xf8, 0x61, 0x80]))] : []), Buffer.from(data)]));
    return { data, key, tsUs: Math.round(Number(p.pts_time) * 1e6), durUs: Math.round(1e6 / fps) };
  });
  if (opts.badAvcC) {                                  // as seen from a Windows hardware encoder: 01 64 00 28 | 03 | 01 | 001b 67 67 64 … | 01 | 0005 68 68 …
    avcC = new Uint8Array(Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0x03, 0x01]), Buffer.from([(sps.length + 1) >> 8, (sps.length + 1) & 255, sps[0]]), Buffer.from(sps), Buffer.from([1, 0, pps.length + 1, pps[0]]), Buffer.from(pps)]));
  }
  return { avcC, goodAvcC, samples, refFile: f, frames: samples.length, reordered: pk.some((p, k) => k && Number(p.pts_time) < Number(pk[k - 1].pts_time)) };
}

/* md5 of every decoded frame, in display order (to prove two files hold identical pictures) */
const frameHashes = file => { const r = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'framemd5', '-']); return r.stdout.split('\n').filter(l => l && l[0] !== '#').map(l => l.split(',').pop().trim()); };

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
module.exports = { haveFfmpeg, h264Samples, h264Reordered, frameHashes, aacFrames, probe, decodeErrors, writeTmp, run, tmp };
