// v0.10.4.6: shared ribbon arrow renderer (H/L badges + the four new flow-arrow looks) - run with: node --test tests/ribbon_arrows.test.js
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', 'studio');
const ctxG = { Math, console }; ctxG.globalThis = ctxG; vm.createContext(ctxG);
vm.runInContext(fs.readFileSync(path.join(root, 'symbols.js'), 'utf8'), ctxG); const Sym = ctxG.Sym;
const ui = fs.readFileSync(path.join(root, 'ui.js'), 'utf8');

function rec() {   // recording fake 2D context
  const log = [], sets = {}, depth = { v: 0, min: 0 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === '__log') return log; if (k === '__sets') return sets; if (k === '__depth') return depth;
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'save') return () => { depth.v++; log.push('save'); }; if (k === 'restore') return () => { depth.v--; depth.min = Math.min(depth.min, depth.v); log.push('restore'); };
      if (k in sets) return sets[k];
      return (...a) => { log.push(k); };
    },
    set(_, k, v) { sets[k] = v; (sets['_all_' + k] = sets['_all_' + k] || []).push(v); return true; },
  });
  return ctx;
}
const count = (c, name) => c.__log.filter(x => x === name).length;
const straight = n => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0 }));

test('ribbonArrow draws every style, keeps save/restore balanced, and ignores a centreline that is too short', () => {
  for (const style of ['tube', 'comet', 'chrome', 'modern']) {
    const c = rec(); Sym.ribbonArrow(c, straight(20), { style, color: '#3fa9ff', size: 40, w0: 12, hw: 22, hl: 30, sweep: 6 });
    assert.ok(count(c, 'fill') + count(c, 'fillRect') >= 1 && count(c, 'stroke') >= 1, style + ' draws');
    assert.strictEqual(c.__depth.v, 0, style + ' save/restore balanced'); assert.ok(c.__depth.min >= 0);
  }
  const c = rec(); Sym.ribbonArrow(c, straight(2), { style: 'modern', color: '#fff', size: 40, w0: 12, hw: 22, hl: 300 }); assert.strictEqual(count(c, 'fill') + count(c, 'fillRect'), 0);
});

test('H arrows turn clockwise, L arrows counter-clockwise, three each, one full turn per 7 s', () => {
  const H0 = Sym.hlArrowAngles('H', 0), H1 = Sym.hlArrowAngles('H', 0.5), L0 = Sym.hlArrowAngles('L', 0), L1 = Sym.hlArrowAngles('L', 0.5);
  assert.strictEqual(H0.length, 3); assert.strictEqual(L0.length, 3);
  H0.forEach((a, i) => assert.ok(H1[i] > a)); L0.forEach((a, i) => assert.ok(L1[i] < a));
  const P = Sym.hlArrowAngles('H', 7); H0.forEach((a, i) => assert.ok(Math.abs(Math.cos(a) - Math.cos(P[i])) < 1e-9));
});

test('drawHL draws 3 clean-modern arrows per badge in the badge colours (no pulsing ring, no old blue/red)', () => {
  for (const [kind, col] of [['H', '#0b24f0'], ['L', '#e60a0a']]) {
    const c = rec(); Sym.drawHL(c, kind, 500, 400, 300, '', 3.2, {});
    assert.strictEqual(c.__depth.v, 0);
    const fills = c.__sets._all_fillStyle || [];
    assert.ok(fills.includes(col), kind + ' arrows use the badge colour ' + col);
    assert.ok(!fills.includes('#2f7bff') && !fills.includes('#ff3b3b'), 'old colours gone');
    assert.strictEqual(count(c, 'clip'), 3, kind + ': exactly three arrows (one clip each)');
    assert.ok((c.__sets._all_strokeStyle || []).includes('rgba(255,255,255,0.92)'), 'clean-modern white edge');
  }
  Sym.hlArrowsEnabled(false); const c = rec(); Sym.drawHL(c, 'H', 500, 400, 300, '', 3.2, {}); assert.strictEqual(count(c, 'clip'), 0); Sym.hlArrowsEnabled(true);
});

test('hlBounds contains the arrows and the value pill', () => {
  const b = Sym.hlBounds(1000, 600, 300); assert.ok(b.x <= 1000 - 300 * 0.9 && b.x + b.w >= 1000 + 300 * 0.9 && b.y <= 600 - 300 * 0.9 && b.y + b.h >= 600 + 300 * 0.93);
});

test('flow arrows: 9 looks all draw (5 originals + tube/comet/chrome/modern); unknown look falls back to glossy', () => {
  const pts = [[100, 500], [500, 380], [900, 420], [1300, 300]];
  const draw = style => { const c = rec(); Sym.drawFlow(c, pts, { color: '#3fa9ff', size: 50, spacing: 2.8, speed: 0, style, t: 1, progress: 1 }); return c; };
  for (const st of ['glossy', 'streak', 'block', 'chevron', 'plain', 'tube', 'comet', 'chrome', 'modern']) { const c = draw(st); assert.ok(c.__log.length > 20, st + ' draws'); assert.strictEqual(c.__depth.v, 0, st + ' balanced'); }
  assert.strictEqual(count(draw('modern'), 'clip') > 0, true); assert.strictEqual(count(draw('glossy'), 'clip'), 0);
  assert.deepStrictEqual(draw('nonsense').__log, draw('glossy').__log);
});

test('the flow-arrows Look dropdown keeps the 5 original looks and adds the 4 ribbon looks', () => {
  const m = ui.match(/B\('style', 'select', \{ label: 'Look', options: \[((?:\['[a-z]+', '[^']*'\],? ?)+)\]/g).map(x => [...x.matchAll(/\['([a-z]+)', '([^']*)'\]/g)].map(y => y[1]));
  const flow = m.find(a => a.includes('streak')); assert.deepStrictEqual(flow, ['glossy', 'streak', 'block', 'chevron', 'tube', 'comet', 'chrome', 'modern', 'plain']);
});
