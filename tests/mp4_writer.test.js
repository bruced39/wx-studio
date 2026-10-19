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
