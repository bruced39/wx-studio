// v0.10.4 performance work: source-level guards so the scene-switch fast path cannot silently regress.
// (Behaviour is covered by tests/browser/perf_scene_switch_check.py.)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'studio', 'ui.js'), 'utf8');
const mb = fs.readFileSync(path.join(__dirname, '..', 'studio', 'mapbox.js'), 'utf8');

test('scene card click uses selectScene, not a full refreshAll rebuild', () => {
  const card = ui.match(/function renderSceneList\(\)[\s\S]*?function mv\(/)[0];
  assert.match(card, /click: \(\) => selectScene\(i\)/);
  assert.doesNotMatch(card, /click: \(\) => \{ backToEdit\(\); S\.si = i;[^}]*refreshAll/);
});
test('selectScene does not rebuild the scene list or touch all thumbnails', () => {
  const fn = ui.match(/function selectScene\(i\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /renderSceneList|refreshAll|thumbSoon\(true\)|thumbSoon\('dirty'\)/);
  assert.match(fn, /classList\.toggle\('on'/);
});
test('renderSceneList refreshes only stale thumbnails and repaints cached ones immediately', () => {
  const fn = ui.match(/function renderSceneList\(\)[\s\S]*?function selectScene/)[0];
  assert.match(fn, /thumbSoon\('dirty'\)/); assert.doesNotMatch(fn, /thumbSoon\(true\)/); assert.match(fn, /paintCached\(cv, ent\)/);
});
test('thumbnail pipeline: signature cache, epoch invalidation for external changes, sliced work', () => {
  assert.match(ui, /function thumbSig\(sc, ss\)/); assert.match(ui, /thumbEpoch\+\+/); assert.match(ui, /E\.onAsset = \(\) => thumbSoon\(true\)/);
  assert.match(ui, /setTimeout\(step, 0\)/);
});
test('map thumbnails are cached only after a real finished frame existed (MB.hasFrame is a pure peek)', () => {
  assert.match(ui, /g\.MB\.hasFrame && g\.MB\.hasFrame\(/);
  const fn = mb.match(/MB\.hasFrame=function[^\n]*/)[0];
  assert.match(fn, /cachedFrame\(keyOf\(bg,cam\)\)/); assert.doesNotMatch(fn, /want=|pump\(/);
});
test('editor loop is paced when slow and yields to pending input; playback path unchanged', () => {
  const fn = ui.match(/function loop\(ts\) \{[\s\S]*?let lastDrawErr/)[0];
  assert.match(fn, /isInputPending/); assert.match(fn, /S\.mode === 'edit' && !S\.draft && !g\.MB\.interacting/); assert.match(fn, /Math\.min\(600, loopStats\.lastCost \* 3\)/);
  assert.match(fn, /E\.renderShow\(sctx, S\.show, S\.T, \{ liveMap: true \}\)/);
});
test('a scene switch forces an immediate repaint even from a throttled idle state', () => {
  const fn = ui.match(/function selectScene\(i\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /lastInputAt = performance\.now\(\); last = 0;/);
});
