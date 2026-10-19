/* WX Studio – portable show file (v0.10.1).
 *
 * Two on-disk forms, both opened by one function (WXShowFile.unpack):
 *   1. `.wxshow.json`  – the original single JSON file (images embedded as data URLs). Still written when a show
 *                        has no video/GIF/audio, so light shows stay readable by older builds.
 *   2. `.wxshow`       – a standard ZIP ("stored", no recompression of already-compressed media) holding:
 *                          manifest.json   format name/version, app version, save time, media list, anything missing
 *                          show.json       the show (same shape as form 1, images embedded)
 *                          media/<id>.<ext>  one file per video / GIF (audio joins here in v0.11.x, same list)
 *                        Any ZIP tool can open it. Every file carries a CRC-32 that is checked on open.
 *
 * The manifest `media[]` list is the one description of a show's media used by the file today and by cloud sync
 * (v0.10.2+): { id, kind:'image'|'video'|'gif'|'audio', name, mime, size, crc32, file?, embedded? }.
 * Unknown fields are ignored on read, so later releases can add `sha256`, `durationSec`, etc. without a new format.
 *
 * Limits: single ZIP, no ZIP64 → a package must stay under 4 GB and 65,535 files; saving says so clearly.     */
(function (g) {
  'use strict';
  const FORMAT = 'wx-studio-show', FORMAT_VERSION = 2, LIMIT = 0xFFFFFFFF;
  const te = new TextEncoder(), td = new TextDecoder('utf-8');
  const HEADER_KEYS = ['format', 'formatVersion', 'savedWith', 'savedAt'];

  /* ---------- CRC-32 (incremental) ---------- */
  const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crcUpdate = (crc, b) => { let c = crc; for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return c >>> 0; };
  const crc32 = b => (crcUpdate(0xFFFFFFFF, b) ^ 0xFFFFFFFF) >>> 0;
  async function eachChunk(data, fn) {
    if (data instanceof Uint8Array) { fn(data); return; }
    const rd = data.stream().getReader();
    for (;;) { const r = await rd.read(); if (r.done) break; fn(r.value); }
  }
  async function crcOf(data) { let c = 0xFFFFFFFF; await eachChunk(data, b => { c = crcUpdate(c, b); }); return (c ^ 0xFFFFFFFF) >>> 0; }

  /* ---------- ZIP writer (stored) ---------- */
  const le16 = n => [n & 255, (n >>> 8) & 255], le32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  function dosTime(d) { return [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF]; }
  /* entries: [{ name, data: Uint8Array | Blob | string }] -> Blob. Never copies Blob data into memory. */
  async function writeZip(entries, opt) {
    opt = opt || {}; const parts = [], central = [], when = dosTime(opt.date || new Date()); let off = 0;
    if (entries.length > 65535) throw new Error('This show has too many files for one package.');
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i], name = te.encode(e.name), data = typeof e.data === 'string' ? te.encode(e.data) : e.data;
      const size = data instanceof Uint8Array ? data.length : data.size;
      if (size > LIMIT) throw new Error('"' + e.name + '" is larger than 4 GB – too large for a single show package.');
      const crc = await crcOf(data);
      const lh = Uint8Array.from([0x50, 0x4b, 3, 4, ...le16(20), ...le16(0x0800), ...le16(0), ...le16(when[0]), ...le16(when[1]), ...le32(crc), ...le32(size), ...le32(size), ...le16(name.length), ...le16(0)]);
      central.push({ name, crc, size, off });
      parts.push(lh, name, data); off += lh.length + name.length + size;
      if (off > LIMIT) throw new Error('This show is larger than 4 GB – too large for a single show package. Use smaller or fewer videos.');
      if (opt.onProgress) opt.onProgress((i + 1) / entries.length, e.name);
    }
    const cdStart = off; let cdLen = 0;
    central.forEach(c => { const h = Uint8Array.from([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(when[0]), ...le16(when[1]), ...le32(c.crc), ...le32(c.size), ...le32(c.size), ...le16(c.name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(c.off)]); parts.push(h, c.name); cdLen += h.length + c.name.length; });
    parts.push(Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...le16(central.length), ...le16(central.length), ...le32(cdLen), ...le32(cdStart), 0, 0]));
    return new Blob(parts, { type: 'application/zip' });
  }

  /* ---------- ZIP reader (stored + deflate; reads lazily from a File/Blob) ---------- */
  const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  async function readZip(blob) {
    if (blob.size < 22) throw new Error('This is not a WX Studio show file (too small).');
    const tailStart = Math.max(0, blob.size - 65557), tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { e = i; break; }
    if (e < 0) throw new Error('This file is damaged or incomplete (no ZIP directory found). It may not have finished downloading.');
    const count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
    if (count === 0xFFFF || cdSize === LIMIT || cdOff === LIMIT) throw new Error('ZIP64 packages are not supported.');
    if (cdOff + cdSize > blob.size) throw new Error('This file is damaged or incomplete (directory is past the end of the file).');
    const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), entries = new Map(); let p = 0;
    for (let i = 0; i < count; i++) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('This file is damaged (bad ZIP directory).');
      const flags = u16(cd, p + 8), method = u16(cd, p + 10), crc = u32(cd, p + 16), csize = u32(cd, p + 20), size = u32(cd, p + 24), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32), off = u32(cd, p + 42);
      const name = td.decode(cd.subarray(p + 46, p + 46 + nl)); if (flags & 1) throw new Error('Encrypted ZIP files are not supported.');
      entries.set(name, { name, method, crc, csize, size, off }); p += 46 + nl + xl + cl;
    }
    const raw = async ent => { const lh = new Uint8Array(await blob.slice(ent.off, ent.off + 30).arrayBuffer()); if (u32(lh, 0) !== 0x04034b50) throw new Error('This file is damaged (bad entry "' + ent.name + '").'); const s = ent.off + 30 + u16(lh, 26) + u16(lh, 28); if (s + ent.csize > blob.size) throw new Error('This file is incomplete ("' + ent.name + '" is cut off).'); return blob.slice(s, s + ent.csize); };
    async function entryBlob(name, type) {
      const ent = entries.get(name); if (!ent) throw new Error('Missing "' + name + '" in the show file.');
      const r = await raw(ent);
      if (ent.method === 0) return type ? r.slice(0, r.size, type) : r;
      if (ent.method === 8) { if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed packages.'); const out = await new Response(r.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob(); return type ? out.slice(0, out.size, type) : out; }
      throw new Error('Unsupported compression in "' + name + '".');
    }
    return {
      entries, has: n => entries.has(n), names: () => [...entries.keys()],
      blob: entryBlob, text: async n => td.decode(new Uint8Array(await (await entryBlob(n)).arrayBuffer())),
      async verify(name) { const ent = entries.get(name); if (!ent) return false; const b = await entryBlob(name); return b.size === ent.size && (await crcOf(b)) === ent.crc; }
    };
  }

  /* ---------- show <-> media ---------- */
  const safeId = id => String(id).replace(/[^\w\-]+/g, '_').slice(0, 80) || 'media';
  const extOf = (name, mime, kind) => { if (kind === 'gif') return '.gif'; const m = String(mime || '').toLowerCase(); if (/mp4/.test(m)) return '.mp4'; if (/webm/.test(m)) return '.webm'; if (/quicktime/.test(m)) return '.mov'; if (/mpeg|mp3/.test(m)) return '.mp3'; if (/wav/.test(m)) return '.wav'; if (/ogg/.test(m)) return '.ogg'; if (/aac|m4a/.test(m)) return '.m4a'; const x = /\.(mp4|m4v|mov|webm|mp3|wav|ogg|m4a|aac)$/i.exec(name || ''); return x ? x[0].toLowerCase() : '.bin'; };
  const MEDIA_FIELDS = ['vid', 'audio'];   // scene.bg.vid today; objects may reference media too (v0.12)
  function mediaRefs(show) {
    const map = new Map(), add = (id, scene) => { if (!id || typeof id !== 'string') return; if (!map.has(id)) map.set(id, []); const a = map.get(id); if (scene && !a.includes(scene)) a.push(scene); };
    (show.scenes || []).forEach((sc, i) => { const nm = sc.name || ('Scene ' + (i + 1)); const bg = sc.bg || {}; MEDIA_FIELDS.forEach(f => add(bg[f], nm)); (sc.objects || []).forEach(o => MEDIA_FIELDS.forEach(f => add(o && o[f], nm))); });
    return map;
  }
  /* What this show needs vs. what this browser has. `videos` is the engine's E.videos registry. */
  function inventory(show, videos) {
    videos = videos || {}; const items = [];
    mediaRefs(show).forEach((scenes, id) => {
      const v = videos[id], has = !!(v && v.blob);
      items.push({ id, kind: v ? (v.gif ? 'gif' : 'video') : 'video', name: (v && v.name) || id, size: has ? v.blob.size : 0, mime: has ? (v.blob.type || '') : '', present: has, scenes, blob: has ? v.blob : null });
    });
    return { items, present: items.filter(i => i.present), missing: items.filter(i => !i.present), imageCount: Object.keys(show.assets || {}).length };
  }
  function header(opt) { return { format: FORMAT, formatVersion: FORMAT_VERSION, savedWith: 'WX Studio ' + (opt.appVersion || ''), savedAt: (opt.now || new Date()).toISOString() }; }
  const imageManifest = show => Object.keys(show.assets || {}).map(id => { const d = show.assets[id]; return { id, kind: 'image', name: id, mime: (/^data:([^;,]+)/.exec(d || '') || [])[1] || '', size: typeof d === 'string' ? d.length : 0, embedded: true }; });

  /* Light show (no video/GIF/audio): the original .wxshow.json with a small header added. */
  function legacyJson(show, opt) { opt = opt || {}; return JSON.stringify(Object.assign({}, header(opt), show)); }

  /* Show with media: the .wxshow package. */
  async function pack(show, opt) {
    opt = opt || {}; const inv = inventory(show, opt.videos), used = {}; inv.present.forEach(i => { used[i.id] = true; });
    const hdr = header(opt), entries = [], media = imageManifest(show);
    const need = inv.present;
    for (const it of need) {
      const file = 'media/' + safeId(it.id) + extOf(it.name, it.mime, it.kind);
      media.push({ id: it.id, kind: it.kind, name: it.name, mime: it.mime, size: it.size, crc32: await crcOf(it.blob), file });
      entries.push({ name: file, data: it.blob });
    }
    const manifest = Object.assign({}, hdr, { show: 'show.json', media, missing: inv.missing.map(m => ({ id: m.id, name: m.name, scenes: m.scenes })) });
    const showText = JSON.stringify(Object.assign({}, hdr, show));
    const all = [{ name: 'manifest.json', data: JSON.stringify(manifest, null, 1) }, { name: 'show.json', data: showText }].concat(entries);
    const blob = await writeZip(all, { onProgress: opt.onProgress, date: opt.now });
    return { blob, manifest, inventory: inv, ext: '.wxshow' };
  }

  const isZipHead = b => b && b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
  function cleanHeader(show) { HEADER_KEYS.forEach(k => { delete show[k]; }); return show; }
  /* Any show file (File/Blob) -> { show, media:[{id,kind,name,mime,blob,size}], warnings[], damaged[], missing[], formatVersion, kind }.
     Throws an Error with a plain-language message if the file is not a usable show. */
  async function unpack(file, opt) {
    opt = opt || {}; const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()), warnings = [], damaged = [];
    if (isZipHead(head)) {
      const z = await readZip(file);
      if (!z.has('manifest.json') || !z.has('show.json')) throw new Error('This ZIP file is not a WX Studio show (no manifest.json / show.json).');
      let manifest, show; try { manifest = JSON.parse(await z.text('manifest.json')); } catch (e) { throw new Error('The show file’s manifest is damaged.'); }
      if (manifest.format !== FORMAT) throw new Error('This ZIP file is not a WX Studio show.');
      if (!(await z.verify('show.json'))) throw new Error('The show inside this file is damaged (checksum mismatch). Try the file again or open a recent autosave.');
      try { show = JSON.parse(await z.text('show.json')); } catch (e) { throw new Error('The show inside this file is damaged.'); }
      if (!show || !Array.isArray(show.scenes) || !show.scenes.length) throw new Error('This file does not contain a show.');
      const fv = +manifest.formatVersion || 0; if (fv > FORMAT_VERSION) warnings.push('This file was saved by a newer WX Studio (format ' + fv + '). Some newer features may be missing after opening.');
      const media = [], list = (manifest.media || []).filter(m => m && m.file);
      for (let i = 0; i < list.length; i++) {
        const m = list[i]; if (opt.onProgress) opt.onProgress(i / Math.max(1, list.length), m.name);
        if (!z.has(m.file)) { damaged.push({ id: m.id, name: m.name, why: 'missing from the file' }); continue; }
        const b = await z.blob(m.file, m.mime || undefined);
        if (!(await z.verify(m.file))) { damaged.push({ id: m.id, name: m.name, why: 'checksum mismatch' }); continue; }
        media.push({ id: m.id, kind: m.kind, name: m.name, mime: m.mime || b.type || '', size: b.size, blob: b });
      }
      return { kind: 'package', show: cleanHeader(show), media, warnings, damaged, missing: manifest.missing || [], formatVersion: fv, manifest };
    }
    let show; try { show = JSON.parse(td.decode(new Uint8Array(await file.arrayBuffer()))); } catch (e) { throw new Error('That file is not a WX Studio show.'); }
    if (!show || !Array.isArray(show.scenes) || !show.scenes.length) throw new Error('That file is not a WX Studio show.');
    const fv = +show.formatVersion || 1; if (fv > FORMAT_VERSION) warnings.push('This file was saved by a newer WX Studio (format ' + fv + '). Some newer features may be missing after opening.');
    const refs = mediaRefs(show);
    return { kind: 'json', show: cleanHeader(show), media: [], warnings, damaged, missing: [...refs.keys()].map(id => ({ id, scenes: refs.get(id) })), formatVersion: fv, manifest: null };
  }

  const api = { FORMAT, FORMAT_VERSION, crc32, crcOf, writeZip, readZip, mediaRefs, inventory, legacyJson, pack, unpack, isZipHead, header };
  g.WXShowFile = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
