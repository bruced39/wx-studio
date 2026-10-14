/* WX Studio – video export.
 * Frames are rendered deterministically (time stepped by 1/fps, not by the wall clock) and fed to the
 * browser's hardware/software H.264 encoder (WebCodecs), then wrapped in an MP4 by mp4.js.
 * Works in current Chrome and Edge. If H.264 encoding is unavailable we fall back to a real-time WebM
 * recording (MediaRecorder).                                                                         */
(function (g) {
  'use strict';
  const H264 = ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.64002a', 'avc1.4d001f', 'avc1.42001f'];
  const X = { H264 };

  X.supportsWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  X.pickCodec = async function (w, h, fps, bitrate, list) {
    if (!X.supportsWebCodecs()) return null;
    for (const codec of (list || H264)) {
      try { const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } }); if (r && r.supported) return codec; } catch (e) { /* try next */ }
    }
    return null;
  };

  /* Encode every frame of the show. sink(chunkBytes, timestampUs, durationUs, isKey, description?) receives the output. */
  X.encodeFrames = async function (show, o, sink) {
    const E = g.Engine, fps = o.fps || 30, W = o.width || 1920, H = o.height || 1080, total = E.total(show), N = Math.max(1, Math.round(total * fps));
    const bitrate = o.bitrate || 10e6, codec = o.codec, cv = document.createElement('canvas'); cv.width = E.W; cv.height = E.H; const c = cv.getContext('2d');
    let out = cv, oc = null; if (W !== E.W || H !== E.H) { out = document.createElement('canvas'); out.width = W; out.height = H; oc = out.getContext('2d'); oc.imageSmoothingQuality = 'high'; }
    let err = null, desc = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = meta.decoderConfig.description; sink(b, chunk.timestamp, chunk.duration || Math.round(1e6 / fps), chunk.type === 'key', desc); },
      error: e => { err = e; }
    });
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' }; if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
    enc.configure(cfg);
    for (let i = 0; i < N; i++) {
      if (err) throw err; if (o.signal && o.signal.aborted) { enc.close(); throw new Error('cancelled'); }
      E.renderShow(c, show, i / fps, { editing: false }); if (oc) oc.drawImage(cv, 0, 0, W, H);
      const frame = new VideoFrame(out, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 }); frame.close();
      while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
      if (i % 6 === 0) { if (o.onProgress) o.onProgress((i + 1) / N); await new Promise(r => setTimeout(r, 0)); }
    }
    await enc.flush(); enc.close(); if (err) throw err; if (o.onProgress) o.onProgress(1);
    return { frames: N, fps };
  };

  async function prepare(show, o) {
    if (g.WDMap && g.WDMap.status === 'idle') await g.WDMap.load();
    else if (g.WDMap && g.WDMap.status === 'loading') { for (let i = 0; i < 100 && g.WDMap.status === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    if (g.WDMap && g.WDMap.countyStatus === 'loading') { for (let i = 0; i < 100 && g.WDMap.countyStatus === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    if (g.WDMap && g.WDMap.placesStatus === 'loading') { for (let i = 0; i < 100 && g.WDMap.placesStatus === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    await g.Engine.preload(show);
    if (document.fonts && document.fonts.ready) { try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* ignore */ } }
  }

  X.run = async function (show, o) {
    o = o || {}; const fps = o.fps || 30, W = o.width || 1920, H = o.height || 1080, bitrate = o.bitrate || 10e6;
    await prepare(show, o);
    const codec = await X.pickCodec(W, H, fps, bitrate, o.codecs);
    if (!codec) return X.runRealtime(show, o);
    const mux = new g.Mp4Writer(W, H); let haveDesc = false;
    await X.encodeFrames(show, Object.assign({}, o, { codec, fps, width: W, height: H, bitrate }), (bytes, ts, dur, key, desc) => { if (desc && !haveDesc) { mux.setDescription(desc); haveDesc = true; } mux.addSample(bytes, ts, dur, key); });
    const blob = new Blob([mux.finalize()], { type: 'video/mp4' });
    return { blob, kind: 'mp4', ext: 'mp4', codec, note: `H.264 MP4, ${W}x${H}, ${fps} fps` };
  };

  /* Fallback: real-time canvas capture -> WebM */
  X.runRealtime = async function (show, o) {
    const E = g.Engine, fps = o.fps || 30, total = E.total(show), cv = document.createElement('canvas'); cv.width = E.W; cv.height = E.H; const c = cv.getContext('2d');
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'], mt = types.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
    if (!mt) throw new Error('This browser cannot encode video. Please use Chrome or Edge.');
    const stream = cv.captureStream(fps), rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: o.bitrate || 10e6 }), parts = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; }); rec.start(250);
    const t0 = performance.now();
    await new Promise(res => { const tick = () => { const T = (performance.now() - t0) / 1000; if (o.signal && o.signal.aborted) return res(); E.renderShow(c, show, Math.min(T, total - 0.001), { editing: false }); if (o.onProgress) o.onProgress(Math.min(1, T / total)); if (T >= total) return res(); requestAnimationFrame(tick); }; tick(); });
    rec.stop(); await done;
    return { blob: new Blob(parts, { type: 'video/webm' }), kind: 'webm', ext: 'webm', codec: mt, note: 'WebM (this browser has no H.264 encoder). Convert to MP4 with HandBrake or ffmpeg before posting to X / Facebook.' };
  };
  g.Exporter = X;
})(typeof window !== 'undefined' ? window : globalThis);
