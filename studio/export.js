/* WX Studio – video export.
 * Frames are rendered deterministically (time stepped by 1/fps, not by the wall clock) and fed to the
 * browser's hardware/software H.264 encoder (WebCodecs), then wrapped in an MP4 by mp4.js.
 * Works in current Chrome and Edge. v0.10.0: if H.264 encoding is unavailable, export STOPS with a clear message
 * (the old real-time WebM recording produced uneven, unseekable files); a WebM draft is still available when the
 * caller opts in with { allowWebM: true }. Frames are converted to YUV here (BT.709, limited range) so the picture
 * matches the BT.709 tags written by mp4.js, instead of leaving the conversion matrix to the browser.        */
(function (g) {
  'use strict';
  const H264 = ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.64002a', 'avc1.4d001f', 'avc1.42001f'];
  const X = { H264 };

  /* ---------- platform presets (one table: check against the platforms' current pages before changing) ---------- */
  X.PRESETS = [
    { id: 'x', label: 'X', title: 'X (Twitter)', width: 1920, height: 1080, fps: 30, bitrate: 16e6, maxSeconds: 140, maxBytes: 512 * 1048576, limitShort: '2:20', limitText: 'standard accounts (longer needs a paid X account)', sizeText: '512 MB', sizeNote: '' },
    { id: 'facebook', label: 'Facebook', title: 'Facebook', width: 1920, height: 1080, fps: 30, bitrate: 16e6, maxSeconds: null, maxBytes: 10 * 1024 * 1048576, limitShort: '', limitText: '', sizeText: '10 GB', sizeNote: ' – not confirmed against Meta’s current page' }
  ];
  X.CUSTOM_SIZES = [['1920x1080', '1920×1080 (Full HD)'], ['1280x720', '1280×720 (smaller file)']];
  X.CUSTOM_QUALITY = [['10', 'Standard quality (10 Mbps)'], ['16', 'High quality (16 Mbps)'], ['6', 'Small file (6 Mbps)']];
  X.AUDIO_BPS = 0;   // audio bitrate added to size estimates once v0.11 adds sound
  /* settings for a preset id ('x' | 'facebook' | 'custom'); custom = { size:'1920x1080', mbps:10 } */
  X.presetSettings = function (id, custom) {
    const p = X.PRESETS.find(q => q.id === id);
    if (p) return { id: p.id, label: p.label, title: p.title, width: p.width, height: p.height, fps: p.fps, bitrate: p.bitrate, maxSeconds: p.maxSeconds, maxBytes: p.maxBytes, limitShort: p.limitShort, limitText: p.limitText, sizeText: p.sizeText, sizeNote: p.sizeNote || '' };
    const c = custom || {}, sz = String(c.size || '1920x1080').split('x').map(Number), mbps = +c.mbps || 10;
    return { id: 'custom', label: 'Custom', title: 'Custom', width: sz[0] || 1920, height: sz[1] || 1080, fps: 30, bitrate: mbps * 1e6, maxSeconds: null, maxBytes: null, limitShort: '', limitText: '', sizeText: '', sizeNote: '' };
  };
  X.estimateBytes = (seconds, bitrate, audioBps) => Math.round(seconds * ((bitrate || 0) + (audioBps || 0)) / 8 * 1.02);
  X.fmtDuration = s => { const t = Math.round(s), m = Math.floor(t / 60); return m + ':' + String(t % 60).padStart(2, '0'); };
  X.fmtBytes = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : (b / 1048576 >= 10 ? Math.round(b / 1048576) : (b / 1048576).toFixed(1)) + ' MB';

  /* Pure: turn the facts about this browser and show into checklist rows { level: 'ok'|'info'|'warn'|'error', text }.
   * facts = { webcodecs, h264 (codec string | null), mapboxScenes:[n], mapboxToken, missing:[{ scene, kind:'video'|'image', name }] }
   * Show length is never restricted – a long show only gets a note for platforms that have a limit. */
  X.preflightItems = function (facts, st, total) {
    const out = [], f = facts || {}, nums = a => a.join(', ');
    if (!f.webcodecs) out.push({ level: 'error', text: 'This browser cannot encode MP4 video. Open WX Studio in current Chrome or Edge.' });
    else if (!f.h264) out.push({ level: 'error', text: `This browser cannot encode H.264 at ${st.width}×${st.height}. Use current Chrome or Edge (a WebM draft is possible but not for posting).` });
    else out.push({ level: 'ok', text: `H.264 encoder available (${f.h264}).` });
    if (f.mapboxScenes && f.mapboxScenes.length) {
      if (!f.mapboxToken) out.push({ level: 'error', text: `Scene${f.mapboxScenes.length > 1 ? 's' : ''} ${nums(f.mapboxScenes)} use${f.mapboxScenes.length > 1 ? '' : 's'} a Mapbox map but no Mapbox token is set (Scene → Mapbox settings).` });
      else out.push({ level: 'info', text: `Map scenes (${nums(f.mapboxScenes)}) render slowly. Keep this tab visible while exporting.` });
    }
    (f.weather || []).forEach(w => {
      const t = `Scene ${w.scene}: weather layer`;
      if (w.state === 'ready') out.push({ level: 'info', text: `${t} has ${w.usable} frame${w.usable === 1 ? '' : 's'} loaded${w.demo ? ' (demo data)' : ''}. Frame times are not checked for freshness.` });
      else if (w.state === 'partial') out.push({ level: 'warn', text: `${t} loaded only ${w.usable} of ${w.total} frames${w.msg ? ' (' + w.msg + ')' : ''}. The export will loop what is available.` });
      else if (w.state === 'loading') out.push({ level: 'warn', text: `${t} is still loading frames. Wait for it to finish, or the export may not include it.` });
      else out.push({ level: 'warn', text: `${t} has no usable frames${w.msg ? ' (' + w.msg + ')' : ''}. The export would show the map without it.` });
    });
    (f.missing || []).forEach(m => out.push({ level: m.kind === 'video' ? 'error' : 'warn', text: `Scene ${m.scene}: ${m.kind === 'video' ? 'video or GIF' : 'image'} “${m.name}” is not available in this browser${m.kind === 'video' ? ' – the export would show a placeholder. Re-import it or remove it.' : ' and will be blank.'}` }));
    if (st.maxSeconds && total > st.maxSeconds) out.push({ level: 'warn', text: `This show is ${X.fmtDuration(total)}. ${st.label}’s published limit is ${st.limitShort} on ${st.limitText}. Platform limits change, so treat this as a guide. You can still export it.` });
    else if (st.maxSeconds) out.push({ level: 'ok', text: `Length ${X.fmtDuration(total)} is within the ${st.limitShort} limit ${st.label} publishes for ${st.limitText.replace(/ \(.*\)/, '')} (a guide; limits can change).` });
    const est = X.estimateBytes(total, st.bitrate, X.AUDIO_BPS);
    if (st.maxBytes && est > st.maxBytes) out.push({ level: 'warn', text: `Estimated file size ${X.fmtBytes(est)} is over ${st.label}’s published ${st.sizeText} guide${st.sizeNote}. Choose Custom → Small file, or shorten the show.` });
    else out.push({ level: 'ok', text: `Estimated file size about ${X.fmtBytes(est)}${st.maxBytes ? ` (published guide ${st.sizeText}${st.sizeNote})` : ''}.` });
    return out;
  };
  X.canExport = items => !items.some(i => i.level === 'error');

  /* Browser: collect the facts for X.preflightItems. */
  X.gatherFacts = async function (show, st) {
    const E = g.Engine, f = { webcodecs: X.supportsWebCodecs(), h264: null, mapboxScenes: [], mapboxToken: !!(g.MB && g.MB.hasToken && g.MB.hasToken()), missing: [] };
    if (f.webcodecs) f.h264 = await X.pickCodec(st.width, st.height, st.fps, st.bitrate);
    const assets = show.assets || {};
    show.scenes.forEach((sc, i) => {
      const n = i + 1, b = sc.bg || {};
      if (b.type === 'mapbox') f.mapboxScenes.push(n);
      if (b.type === 'video') { const v = E && E.videos && E.videos[b.vid]; if (!v || v.err) f.missing.push({ scene: n, kind: 'video', name: (v && v.name) || b.vid || 'unknown' }); }
      if (b.type === 'image' && b.asset && !assets[b.asset]) f.missing.push({ scene: n, kind: 'image', name: b.asset });
      (sc.objects || []).forEach(o => { if (o.type === 'image' && o.asset && !assets[o.asset]) f.missing.push({ scene: n, kind: 'image', name: o.asset }); });
    });
    /* Weather loop layers: ask WXData whether each enabled layer has frames that are actually decoded (not just a connected source). */
    f.weather = [];
    const D = g.WXData;
    if (D && D.exportReadiness) {
      for (let i = 0; i < show.scenes.length; i++) {
        const sc = show.scenes[i]; if (!(sc.dataLoop && sc.dataLoop.on)) continue;
        try { if (D.ensure) await Promise.race([D.ensure(sc), new Promise(r => setTimeout(r, 6000))]); } catch (e) { /* readiness reports the failure */ }
        f.weather.push(Object.assign({ scene: i + 1 }, D.exportReadiness(sc)));
      }
    }
    return f;
  };

  /* ---------- colour: RGBA -> I420, BT.709, limited range (Y 16–235, Cb/Cr 16–240), 2×2 averaged chroma ---------- */
  X.rgbaToI420 = function (rgba, w, h, out) {
    const ys = w * h, us = ys >> 2, U0 = ys, V0 = ys + us, cw = w >> 1;
    for (let i = 0, p = 0; i < ys; i++, p += 4) out[i] = 16 + ((11966 * rgba[p] + 40253 * rgba[p + 1] + 4064 * rgba[p + 2] + 32768) >> 16);
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const a = (y * w + x) * 4, b = a + 4, c = a + w * 4, d = c + 4;
        const r = (rgba[a] + rgba[b] + rgba[c] + rgba[d] + 2) >> 2, gg = (rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[d + 1] + 2) >> 2, bb = (rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[d + 2] + 2) >> 2;
        const k = (y >> 1) * cw + (x >> 1);
        out[U0 + k] = 128 + ((-6596 * r - 22189 * gg + 28784 * bb + 32768) >> 16);
        out[V0 + k] = 128 + ((28784 * r - 26145 * gg - 2639 * bb + 32768) >> 16);
      }
    }
    return out;
  };

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
    // Own YUV conversion (BT.709, limited range) so the pixels match the colour tags; falls back to the browser's
    // conversion (and the muxer then leaves the video untagged) if an I420 frame cannot be built.
    let yuv = null, rbc = null, colorMode = 'native';
    if (o.color !== 'native' && W % 2 === 0 && H % 2 === 0) { try { const rb = document.createElement('canvas'); rb.width = W; rb.height = H; rbc = rb.getContext('2d', { willReadFrequently: true }); yuv = new Uint8Array(W * H * 3 / 2); colorMode = 'bt709'; } catch (e) { yuv = null; colorMode = 'native'; } }
    const mkFrame = (ts, dur) => {
      if (colorMode === 'bt709') {
        try { rbc.drawImage(out, 0, 0, W, H); X.rgbaToI420(rbc.getImageData(0, 0, W, H).data, W, H, yuv); return new VideoFrame(yuv, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts, duration: dur, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } }); }
        catch (e) { colorMode = 'native'; }
      }
      return new VideoFrame(out, { timestamp: ts, duration: dur });
    };
    const enc = new VideoEncoder({
      output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = meta.decoderConfig.description; sink(b, chunk.timestamp, chunk.duration || Math.round(1e6 / fps), chunk.type === 'key', desc); },
      error: e => { err = e; }
    });
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' }; if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
    enc.configure(cfg);
    for (let i = 0; i < N; i++) {
      if (err) throw err; if (o.signal && o.signal.aborted) { enc.close(); throw new Error('cancelled'); }
      await E.prepareFrame(show, i / fps); E.renderShow(c, show, i / fps, { editing: false }); if (oc) oc.drawImage(cv, 0, 0, W, H);
      const frame = mkFrame(Math.round(i * 1e6 / fps), Math.round(1e6 / fps));
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 }); frame.close();
      while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
      if (i % 6 === 0) { if (o.onProgress) o.onProgress((i + 1) / N); await new Promise(r => setTimeout(r, 0)); }
    }
    await enc.flush(); enc.close(); if (err) throw err; if (o.onProgress) o.onProgress(1);
    return { frames: N, fps, color: colorMode };
  };

  async function prepare(show, o) {
    if (g.WDMap && g.WDMap.status === 'idle') await g.WDMap.load();
    else if (g.WDMap && g.WDMap.status === 'loading') { for (let i = 0; i < 100 && g.WDMap.status === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    if (g.WDMap && g.WDMap.countyStatus === 'loading') { for (let i = 0; i < 100 && g.WDMap.countyStatus === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    if (g.WDMap && g.WDMap.placesStatus === 'loading') { for (let i = 0; i < 100 && g.WDMap.placesStatus === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    if (g.MB && show.scenes.some(s => s.bg.type === 'mapbox')) await g.MB.init();
    await g.Engine.preload(show);
    if (document.fonts && document.fonts.ready) { try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* ignore */ } }
  }

  X.run = async function (show, o) {
    g.Engine.exporting = true; try { return await X.run0(show, o); } finally { g.Engine.exporting = false; }
  };
  X.NO_H264_MESSAGE = 'This browser cannot encode H.264 video, so it cannot make an MP4 for X or Facebook. Open WX Studio in current Chrome or Edge.';
  X.run0 = async function (show, o) {
    o = o || {}; const fps = o.fps || 30, W = o.width || 1920, H = o.height || 1080, bitrate = o.bitrate || 10e6;
    await prepare(show, o);
    const codec = await X.pickCodec(W, H, fps, bitrate, o.codecs);
    if (!codec) {
      if (o.allowWebM) { g.Engine.exporting = false; return X.runRealtime(show, o); }
      const e = new Error(X.NO_H264_MESSAGE); e.code = 'NO_H264'; throw e;
    }
    const mux = new g.Mp4Writer(W, H); let haveDesc = false;
    const info = await X.encodeFrames(show, Object.assign({}, o, { codec, fps, width: W, height: H, bitrate }), (bytes, ts, dur, key, desc) => { if (desc && !haveDesc) { mux.setDescription(desc); haveDesc = true; } mux.addSample(bytes, ts, dur, key); });
    if (info.color !== 'bt709') mux.setColor(false);   // never tag colours we did not control
    const blob = new Blob([mux.finalize()], { type: 'video/mp4' });
    return { blob, kind: 'mp4', ext: 'mp4', codec, width: W, height: H, fps, frames: info.frames, seconds: info.frames / fps, color: info.color, note: `H.264 MP4, ${W}x${H}, ${fps} fps` };
  };

  /* Play the finished file back in a <video> to confirm it opens, has the right size and length, and its first and last
   * frames decode. 'unverified' (browser cannot play it) is not a failure; 'failed' means do not upload it.            */
  X.verify = function (blob, expect) {
    expect = expect || {};
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob), v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true;
      let done = false; const finish = r => { if (done) return; done = true; clearTimeout(tm); try { v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ } URL.revokeObjectURL(url); resolve(r); };
      const unver = why => finish({ status: 'unverified', text: 'This browser could not play the file back to check it' + (why ? ' (' + why + ')' : '') + '. That does not mean it is broken – open it in a video player before uploading.' });
      const tm = setTimeout(() => unver('timed out'), expect.timeoutMs || 15000);
      const seek = t => new Promise((res, rej) => { const ok = () => { v.removeEventListener('seeked', ok); res(); }; v.addEventListener('seeked', ok); v.addEventListener('error', () => rej(new Error('seek failed')), { once: true }); v.currentTime = t; });
      const grab = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36); x.getImageData(0, 0, 1, 1); return v.readyState >= 2; };
      v.onerror = () => unver('playback error');
      v.onloadedmetadata = async () => {
        try {
          const d = v.duration, w = v.videoWidth, h = v.videoHeight, bits = [];
          if (!isFinite(d)) return unver('no duration in file');
          const tol = Math.max(0.1, 2 / (expect.fps || 30));
          if (expect.width && (w !== expect.width || h !== expect.height)) return finish({ status: 'failed', text: `The file is ${w}×${h} but ${expect.width}×${expect.height} was expected. Do not upload it; export again.` });
          if (expect.duration && Math.abs(d - expect.duration) > tol) return finish({ status: 'failed', text: `The file is ${d.toFixed(1)} s long but the show is ${expect.duration.toFixed(1)} s. Do not upload it; export again.` });
          await seek(Math.min(0.05, d / 2)); if (!grab()) return finish({ status: 'failed', text: 'The first frame of the file could not be decoded. Do not upload it; export again.' });
          await seek(Math.max(0, d - 0.1)); if (!grab()) return finish({ status: 'failed', text: 'The last frame of the file could not be decoded. Do not upload it; export again.' });
          finish({ status: 'verified', width: w, height: h, duration: d, text: `Checked: ${w}×${h}, ${d.toFixed(1)} s, first and last frames decode.` });
        } catch (e) { unver(e && e.message); }
      };
      v.src = url;
    });
  };

  /* Two-second test export through the real pipeline, so you can see whether this browser can make the MP4. */
  X.selfTest = async function (onProgress) {
    const E = g.Engine, t0 = performance.now();
    const sc = E.newScene({ name: 'Self-test', duration: 2, bg: { type: 'solid', color: '#103050', kenburns: false }, title: { show: false, text: '', sub: '' }, objects: [E.newObject('text', { text: 'WX Studio export test', x: 960, y: 540, size: 120 })] });
    const show = { name: 'self-test', accent: '#2f9bff', scenes: [sc], assets: {} }, st = X.presetSettings('facebook');
    const r = { ok: false, text: '', ms: 0 };
    try {
      const out = await X.run(show, { width: st.width, height: st.height, fps: st.fps, bitrate: 8e6, onProgress });
      const v = await X.verify(out.blob, { width: out.width, height: out.height, duration: out.seconds, fps: out.fps });
      r.ms = Math.round(performance.now() - t0); r.codec = out.codec; r.bytes = out.blob.size; r.color = out.color; r.verify = v.status;
      r.ok = v.status !== 'failed';
      r.text = `This browser made a valid ${out.width}×${out.height} H.264 MP4 (${out.codec}) in ${(r.ms / 1000).toFixed(1)} s. ${v.text}` + (out.color === 'bt709' ? '' : ' Colours are not tagged BT.709 in this browser.');
    } catch (e) { r.ms = Math.round(performance.now() - t0); r.text = e && e.code === 'NO_H264' ? X.NO_H264_MESSAGE : 'Self-test failed: ' + (e && e.message || e); r.code = e && e.code; }
    return r;
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
  if (typeof module !== 'undefined') module.exports = X;
})(typeof window !== 'undefined' ? window : globalThis);
