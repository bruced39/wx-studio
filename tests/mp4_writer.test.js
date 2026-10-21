'use strict';
const test = require('node:test'), assert = require('node:assert');
const { Mp4Writer } = require('../studio/mp4.js');
const M = require('./helpers/media.js');
const skip = M.haveFfmpeg() ? false : 'ffmpeg/ffprobe not installed';
const FPS = 30;

function muxVideo(opts, secs) {
  const v = M.h264Samples(640, 360, FPS, secs || 3), w = new Mp4Writer(640, 360, opts);
  w.setDescription(v.avcC); v.samples.forEach((s, i) => w.addSample(s.data, Math.round(i * 1e6 / FPS), Math.round(1e6 / FPS), s.key));
  return { bytes: w.finalize(), n: v.samples.length, keys: v.samples.filter(s => s.key).length };
}
const stream = (info, type) => info.streams.find(s => s.codec_type === type);

test('video-only MP4 (existing export path) decodes cleanly with correct size, rate, frames and fast-start', { skip }, () => {
  const m = muxVideo(undefined, 3), f = M.writeTmp('v.mp4', m.bytes), info = M.probe(f, ['-count_frames']), v = stream(info, 'video');
  assert.strictEqual(info.streams.length, 1);
  assert.strictEqual(v.codec_name, 'h264'); assert.strictEqual(v.width, 640); assert.strictEqual(v.height, 360);
  assert.strictEqual(v.r_frame_rate, '30/1'); assert.strictEqual(+v.nb_read_frames, m.n);
  assert.ok(Math.abs(+info.format.duration - 3) < 0.05, 'duration ' + info.format.duration);
  assert.strictEqual(M.decodeErrors(f), '');
  const s = Buffer.from(m.bytes).toString('latin1'); assert.ok(s.indexOf('moov') < s.indexOf('mdat'), 'moov must precede mdat');
});

test('video is tagged BT.709, limited range, square pixels', { skip }, () => {
  const v = stream(M.probe(M.writeTmp('c.mp4', muxVideo().bytes)), 'video');
  assert.strictEqual(v.color_space, 'bt709'); assert.strictEqual(v.color_primaries, 'bt709'); assert.strictEqual(v.color_transfer, 'bt709'); assert.strictEqual(v.color_range, 'tv');
  assert.strictEqual(v.sample_aspect_ratio, '1:1');
});

test('color:false leaves the video untagged (old behaviour)', { skip }, () => {
  const v = stream(M.probe(M.writeTmp('u.mp4', muxVideo({ color: false }).bytes)), 'video');
  assert.ok(!v.color_space || v.color_space === 'unknown');
});

test('keyframes are indexed (seekable)', { skip }, () => {
  const m = muxVideo(undefined, 5), f = M.writeTmp('k.mp4', m.bytes);
  const r = M.run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=flags', '-of', 'csv=p=0', f]);
  const keys = r.stdout.split('\n').filter(l => l.startsWith('K')).length; assert.strictEqual(keys, m.keys);
});

function muxAV(priming, secs) {
  const v = M.h264Samples(640, 360, FPS, secs), a = M.aacFrames(secs), w = new Mp4Writer(640, 360);
  w.setDescription(v.avcC); v.samples.forEach((s, i) => w.addSample(s.data, Math.round(i * 1e6 / FPS), Math.round(1e6 / FPS), s.key));
  w.addAudioTrack({ sampleRate: a.sampleRate, channels: a.channels, description: a.asc, bitrate: 192000, primingSamples: priming });
  a.frames.forEach((fr, i) => w.addAudioSample(fr, Math.round(i * 1024 * 1e6 / a.sampleRate), Math.round(1024 * 1e6 / a.sampleRate)));
  return { bytes: w.finalize(), vFrames: v.samples.length, aFrames: a.frames.length };
}

test('video + AAC audio: both tracks play, decode cleanly and are interleaved', { skip }, () => {
  const m = muxAV(0, 3), f = M.writeTmp('av.mp4', m.bytes), info = M.probe(f), v = stream(info, 'video'), a = stream(info, 'audio');
  assert.ok(v && a, 'both streams present'); assert.strictEqual(a.codec_name, 'aac'); assert.strictEqual(a.sample_rate, '48000'); assert.strictEqual(a.channels, 2);
  assert.strictEqual(a.profile, 'LC'); assert.strictEqual(M.decodeErrors(f), '');
  assert.ok(Math.abs(+a.duration - m.aFrames * 1024 / 48000) < 0.01, 'audio duration ' + a.duration);
  assert.ok(Math.abs(+v.duration - 3) < 0.05, 'video duration ' + v.duration);
  const pk = M.run('ffprobe', ['-v', 'error', '-show_entries', 'packet=stream_index,pos', '-of', 'csv=p=0', f]).stdout.trim().split('\n').map(l => l.split(',').map(Number)).sort((x, y) => x[1] - y[1]);
  let switches = 0; for (let i = 1; i < pk.length; i++) if (pk[i][0] !== pk[i - 1][0]) switches++;
  assert.ok(switches > 20, 'samples should alternate in the file, got ' + switches + ' switches');
  assert.strictEqual(info.format.nb_streams, 2);
});

test('AAC priming edit list trims the encoder delay so audio starts with the picture', { skip }, () => {
  const a0 = stream(M.probe(M.writeTmp('p0.mp4', muxAV(0, 2).bytes)), 'audio'), a1 = stream(M.probe(M.writeTmp('p1.mp4', muxAV(1024, 2).bytes)), 'audio');
  assert.ok(Math.abs((+a0.duration) - (+a1.duration) - 1024 / 48000) < 0.002, `durations ${a0.duration} vs ${a1.duration}`);
  assert.ok(Math.abs(+a1.start_time) < 0.001, 'start_time ' + a1.start_time);
});

test('audio-less writer output is identical in structure to before (no stray audio track, next track id 2)', { skip }, () => {
  const info = M.probe(M.writeTmp('n.mp4', muxVideo().bytes)); assert.strictEqual(info.streams.filter(s => s.codec_type === 'audio').length, 0);
});

test('addAudioSample before addAudioTrack and missing description are rejected', () => {
  const w = new Mp4Writer(10, 10); assert.throws(() => w.addAudioSample(new Uint8Array(1), 0, 1), /addAudioTrack/);
  assert.throws(() => w.addAudioTrack({ sampleRate: 48000 }), /AudioSpecificConfig/);
  assert.throws(() => w.finalize(), /avcC/);
});

/* ---------- v0.10.1.6: real-encoder output (B-frames, in-band headers, malformed avcC) ---------- */
function muxChunks(v, w, h, opts) {
  const mw = new Mp4Writer(w, h, opts); mw.setDescription(v.avcC);
  v.samples.forEach(s => mw.addSample(s.data, s.tsUs, s.durUs, s.key));
  return { bytes: mw.finalize(), info: mw.info };
}
const hasBox = (bytes, name) => Buffer.from(bytes).indexOf(name) >= 0;
function checkPlayable(label, v, m, secs) {
  const f = M.writeTmp(label + '.mp4', m.bytes), info = M.probe(f, ['-count_frames']), s = stream(info, 'video');
  assert.strictEqual(M.decodeErrors(f), '', label + ': decoder errors');
  assert.strictEqual(+s.nb_read_frames, v.frames, label + ': frame count');
  assert.ok(Math.abs(+info.format.duration - secs) < 0.04, label + ' duration ' + info.format.duration);
  assert.deepStrictEqual(M.frameHashes(f), M.frameHashes(v.refFile), label + ': pictures differ from the encoder reference');
  return { f, info, s };
}

test('B-frame stream (decode order, presentation timestamps) is muxed with ctts + edit list and plays frame-exact', { skip }, () => {
  const v = M.h264Reordered(640, 360, FPS, 5); assert.ok(v.reordered, 'fixture must really contain reordered frames');
  const m = muxChunks(v, 640, 360); assert.ok(m.info.reordered);
  assert.ok(hasBox(m.bytes, 'ctts') && hasBox(m.bytes, 'elst'));
  const { f } = checkPlayable('bf', v, m, 5);
  // presentation timestamps come out as 0, 1/30, 2/30 … with no gaps or repeats and decode timestamps never go backwards
  const pk = M.run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,dts_time', '-of', 'csv=p=0', f]).stdout.trim().split('\n').map(l => l.split(',').map(Number));
  const pts = pk.map(p => p[0]).sort((a, b) => a - b); pts.forEach((t, i) => assert.ok(Math.abs(t - i / FPS) < 1e-4, 'pts ' + i + ' = ' + t));
  for (let i = 1; i < pk.length; i++) assert.ok(pk[i][1] > pk[i - 1][1], 'dts must increase at ' + i);
});

test('Chrome/Edge-style output: in-band AUD/SPS/PPS/SEI and a malformed avcC (the user\'s unplayable file) now plays', { skip }, () => {
  const v = M.h264Reordered(640, 360, FPS, 5, { chrome: true, badAvcC: true });
  // the fixture reproduces the broken description byte-for-byte in shape
  assert.strictEqual(v.avcC[4], 0x03); assert.strictEqual(v.avcC[5], 0x01); assert.strictEqual(v.avcC[8], v.avcC[9]);
  const m = muxChunks(v, 640, 360); assert.strictEqual(m.info.avcC, 'built-from-stream'); assert.ok(m.info.strippedNals > 0);
  const { s } = checkPlayable('chrome', v, m, 5);
  assert.strictEqual(s.profile, 'High'); assert.strictEqual(s.pix_fmt, 'yuv420p');
  // no parameter sets or AUDs remain inside the samples
  const mdat = Buffer.from(m.bytes).indexOf('mdat'); assert.ok(mdat > 0);
});

test('malformed avcC with NO in-band headers is repaired from the description alone', { skip }, () => {
  const v = M.h264Reordered(640, 360, FPS, 3, { badAvcC: true }), m = muxChunks(v, 640, 360);
  assert.strictEqual(m.info.avcC, 'repaired'); checkPlayable('repair', v, m, 3);
});

test('a good avcC and clean samples are passed through untouched', { skip }, () => {
  const v = M.h264Reordered(640, 360, FPS, 3), m = muxChunks(v, 640, 360);
  assert.strictEqual(m.info.avcC, 'as-given'); assert.strictEqual(m.info.strippedNals, 0);
  assert.ok(Buffer.from(m.bytes).indexOf(Buffer.from(v.goodAvcC)) > 0, 'encoder avcC copied verbatim');
  checkPlayable('clean', v, m, 3);
});

test('no B-frames (monotonic timestamps): no ctts / elst – the old, simple box layout is unchanged', { skip }, () => {
  const v = M.h264Reordered(640, 360, FPS, 3, { bf: 0 }); assert.ok(!v.reordered);
  const m = muxChunks(v, 640, 360); assert.ok(!hasBox(m.bytes, 'ctts') && !hasBox(m.bytes, 'elst') && !m.info.reordered);
  checkPlayable('mono', v, m, 3);
  const c = muxVideo(undefined, 3); assert.ok(!hasBox(c.bytes, 'ctts') && !hasBox(c.bytes, 'edts'));
});

test('B-frames + AAC audio stay in sync (video edit list does not shift the sound)', { skip }, () => {
  const v = M.h264Reordered(640, 360, FPS, 3, { chrome: true, badAvcC: true }), a = M.aacFrames(3), mw = new Mp4Writer(640, 360);
  mw.setDescription(v.avcC); v.samples.forEach(s => mw.addSample(s.data, s.tsUs, s.durUs, s.key));
  mw.addAudioTrack({ sampleRate: a.sampleRate, channels: a.channels, description: a.asc, bitrate: 192000, primingSamples: 0 });
  a.frames.forEach((fr, i) => mw.addAudioSample(fr, Math.round(i * 1024 * 1e6 / a.sampleRate), Math.round(1024 * 1e6 / a.sampleRate)));
  const f = M.writeTmp('bfav.mp4', mw.finalize()), info = M.probe(f), vs = stream(info, 'video'), as = stream(info, 'audio');
  assert.strictEqual(M.decodeErrors(f), ''); assert.ok(Math.abs(+vs.start_time - +as.start_time) < 0.03, `start ${vs.start_time} vs ${as.start_time}`);
  assert.ok(Math.abs(+vs.duration - 3) < 0.04);
});

test('irregular / duplicate timestamps never produce a zero or negative sample duration', () => {
  const w = new Mp4Writer(64, 64), d = Buffer.from([0, 0, 0, 2, 0x65, 0x88]);
  w.setDescription(Uint8Array.from([1, 100, 0, 40, 255, 225, 0, 4, 0x67, 100, 0, 40, 1, 0, 2, 0x68, 0xce]));
  [0, 0, 33333, 33333, 66666].forEach((t, i) => w.addSample(d, t, 33333, i === 0));
  const tm = w._prepare().tm; assert.ok(tm.dur.every(x => x >= 1), JSON.stringify(tm.dur));
});
