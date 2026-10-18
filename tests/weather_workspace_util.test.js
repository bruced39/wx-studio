// Pure-logic tests for studio/weather_workspace.js helpers (no browser, no DOM, no network).
// The panel itself is verified in a real browser by tests/browser/weather_workspace_browser_check.py.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.globalThis = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../studio/weather_workspace.js'), 'utf8'), sandbox);
const U = sandbox.WXWeatherWorkspace.util;
const plain = x => JSON.parse(JSON.stringify(x));   // the module runs in another vm realm; compare plain data

test('module exposes helpers without WXData/document present and does not throw', () => {
  assert.equal(typeof U.parsePalette, 'function');
  assert.equal(sandbox.WXWeatherWorkspace.capabilities.layerPosition, false);
});
test('normHex accepts #rrggbb, rrggbb, #rgb and r,g,b; rejects junk', () => {
  assert.equal(U.normHex('#04E9E7'), '#04e9e7'); assert.equal(U.normHex('04e9e7'), '#04e9e7'); assert.equal(U.normHex('#fa0'), '#ffaa00');
  assert.equal(U.normHex('255 128 0'), '#ff8000'); assert.equal(U.normHex('rgb(0,0,255)'), '#0000ff');
  for (const bad of ['', null, '#12', '#gggggg', '256,0,0', 'blue']) assert.equal(U.normHex(bad), null, String(bad));
});
test('parsePalette: our JSON export round-trips', () => {
  const j = U.parsePalette(JSON.stringify({ schema: 'wxstudio.palette.v1', name: 'X', category: 'satellite', productId: 'abi_c13', units: '°C', continuous: true, stops: [[-50, '#FFFFFF'], [0, '#000000']] }));
  assert.deepEqual(JSON.parse(JSON.stringify(j)), { name: 'X', category: 'satellite', productId: 'abi_c13', units: '°C', continuous: true, stops: [[-50, '#ffffff'], [0, '#000000']] });
});
test('parsePalette: bare arrays, {value,color} objects and unsorted input are sorted', () => {
  assert.deepEqual(plain(U.parsePalette('[[10,"#00ff00"],[0,"#ff0000"]]').stops), [[0, '#ff0000'], [10, '#00ff00']]);
  assert.deepEqual(plain(U.parsePalette('[{"value":5,"color":"#111111"},{"v":1,"c":"#222222"}]').stops), [[1, '#222222'], [5, '#111111']]);
});
test('parsePalette: CSV/text with header, comments, hex, short hex and r g b', () => {
  const t = 'value,color\n# comment\n0,#000000\n50,255 128 0\n100;#fff\n';
  assert.deepEqual(plain(U.parsePalette(t).stops), [[0, '#000000'], [50, '#ff8000'], [100, '#ffffff']]);
  assert.deepEqual(plain(U.parsePalette('\uFEFF0 #000\n10 #fff').stops), [[0, '#000000'], [10, '#ffffff']]);
});
test('parsePalette: clear errors for empty, bad JSON, one stop, duplicate values, bad colors, bad numbers, too many', () => {
  assert.throws(() => U.parsePalette('   '), /empty/);
  assert.throws(() => U.parsePalette('{nope'), /not valid JSON/);
  assert.throws(() => U.parsePalette('{"name":"a"}'), /No "stops"/);
  assert.throws(() => U.parsePalette('0,#000000'), /at least 2/);
  assert.throws(() => U.parsePalette('0,#000000\n0,#ffffff'), /share the value 0/);
  assert.throws(() => U.parsePalette('0,#000000\n5,red'), /unreadable color/);
  assert.throws(() => U.parsePalette('0,#000000\n5,#ffffff\nabc,#ffffff'), /not a number/);
  assert.throws(() => U.parsePalette(JSON.stringify(Array.from({ length: 257 }, (_, i) => [i, '#000000']))), /at most 256/);
});
test('lutFromStops: stepped keeps hard class edges, continuous blends', () => {
  const stops = [[0, '#000000'], [10, '#ffffff']];
  const st = U.lutFromStops(stops, false, 11), co = U.lutFromStops(stops, true, 11), px = (a, i) => [...a.slice(i * 4, i * 4 + 4)];
  assert.deepEqual(px(st, 0), [0, 0, 0, 255]); assert.deepEqual(px(st, 9), [0, 0, 0, 255], 'stepped: values below 10 stay in the first class');
  assert.deepEqual(px(st, 10), [255, 255, 255, 255], 'stepped: the last class starts at its own value');
  assert.ok(Math.abs(co[5 * 4] - 127.5) < 1.5, 'continuous: the midpoint is mid-grey'); assert.ok(co[9 * 4] > 200, 'continuous: ramps up gradually');
});
test('groupPalettes groups by category then product; palettes with no product go under "All"', () => {
  const g = U.groupPalettes([{ id: 'a', category: 'radar', productIds: ['p1', 'p2'] }, { id: 'b', category: 'radar' }, { id: 'c', category: 'satellite', productIds: ['abi_c13'] }], k => 'L:' + k);
  assert.deepEqual(plain(Object.keys(g.radar)), ['p1', 'p2', '*']); assert.equal(g.radar.p1.label, 'L:p1'); assert.equal(g.radar['*'].label, 'All radar products');
  assert.equal(g.satellite.abi_c13.items[0].id, 'c');
});
test('bridgeSummary never says Connected unless the processor has fresh products', () => {
  const s = U.bridgeSummary;
  assert.equal(s(null).pill, 'notconnected');
  assert.equal(s({ status: 'not-configured' }).title, 'Not connected');
  assert.match(s({ status: 'not-configured' }).detail, /WX_WEATHER_PROCESSOR_URL/);
  assert.equal(s({ status: 'checking' }).pill, 'notconnected');
  assert.equal(s({ status: 'unavailable', error: 'x' }).title, 'Not connected');
  assert.match(s({ status: 'unavailable', error: 'processor returned 503' }).detail, /503/);
  const empty = s({ status: 'no-fresh-data', products: [] }); assert.equal(empty.title, 'No fresh data'); assert.notEqual(empty.pill, 'connected');
  const ok = s({ status: 'available', products: ['a', 'b'], lastCheck: 0 }); assert.equal(ok.pill, 'connected'); assert.match(ok.short, /2 live NOAA products/);
  assert.match(s({ status: 'available', products: ['a'] }).short, /1 live NOAA product$/);
});
test('slug is safe for file names and ids', () => {
  assert.equal(U.slug('Boston IR!!'), 'boston-ir'); assert.equal(U.slug(''), 'palette'); assert.ok(U.slug('x'.repeat(200)).length <= 40);
});
