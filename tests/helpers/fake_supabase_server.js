'use strict';
/* Local HTTP wrapper around the fake Supabase (used by the real-browser checks). Usage: node fake_supabase_server.js <port>
 * Adds fake email/password auth (a@x.test / b@x.test, password "pw") and /__admin helpers for the test to inspect and break things. */
const http = require('node:http');
const { createFakeSupabase } = require('./fake_supabase.js');
const { createPgSupabase, USERS } = require('./pg_supabase.js');
const PG = process.env.WX_BACKEND === 'pg';       // PG: the REAL v0.10.2 migrations in a local PostgreSQL (WX_MIGRATIONS_DIR); default: the in-memory fake
let fake = PG ? null : createFakeSupabase();
const users = PG ? { 'a@x.test': { id: USERS['a@x.test'], pw: 'pw' }, 'b@x.test': { id: USERS['b@x.test'], pw: 'pw' } } : { 'a@x.test': { id: 'user-a', pw: 'pw' }, 'b@x.test': { id: 'user-b', pw: 'pw' } };
const send = (res, status, body, type) => { res.writeHead(status, { 'content-type': type || 'application/json' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const reset = async () => { if (PG) { await fake.query('TRUNCATE public.wx_studio_workspace, public.wx_studio_show_versions, public.wx_studio_shows, public.wx_studio_media, public.wx_studio_user_settings CASCADE; DELETE FROM storage.objects;'); fake.objects.clear(); } else fake = createFakeSupabase(); };
(async () => { if (PG) { fake = await createPgSupabase(); if (!fake) { console.error('PostgreSQL or migrations unavailable'); process.exit(3); } process.on('SIGTERM', async () => { await fake.close(); process.exit(0); }); } serve(); })();
function serve() { http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://x');
  const ctype = req.headers['content-type'] || '';
  if (u.pathname === '/__admin/ids') return send(res, 200, { a: users['a@x.test'].id, b: users['b@x.test'].id });
  if (u.pathname === '/__admin/state') {
    if (PG) { const R = t => fake.rows(`SELECT to_jsonb(x) - 'last_op_result' FROM public.${t} x`); return send(res, 200, { shows: await R('wx_studio_shows'), versions: await R('wx_studio_show_versions'), settings: await R('wx_studio_user_settings'), workspace: await R('wx_studio_workspace'), media: await R('wx_studio_media'), objects: [...fake.objects.keys()], calls: fake.calls.length }); }
    const { shows, versions, settings, workspace, media } = fake.db; return send(res, 200, { shows, versions, settings, workspace, media, objects: [...fake.objects.keys()], calls: fake.calls.length }); }
  if (u.pathname === '/__admin/faults') { Object.assign(fake.faults, JSON.parse(raw.toString() || '{}')); return send(res, 200, fake.faults); }
  if (u.pathname === '/__admin/reset') { await reset(); return send(res, 200, { ok: true }); }
  if (u.pathname === '/__admin/advance') { if (fake.advance) fake.advance(+u.searchParams.get('ms') || 0); return send(res, 200, { ok: true }); }
  if (u.pathname === '/auth/v1/token') {
    const b = JSON.parse(raw.toString() || '{}'), usr = users[String(b.email || '').toLowerCase()];
    if (u.searchParams.get('grant_type') === 'refresh_token') { const uid = String(b.refresh_token || '').replace(/^r_/, ''); return send(res, 200, { access_token: fake.token(uid), refresh_token: 'r_' + uid, expires_in: 3600, user: { id: uid, email: Object.keys(users).find(k => users[k].id === uid) } }); }
    if (!usr || usr.pw !== b.password) return send(res, 400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return send(res, 200, { access_token: fake.token(usr.id), refresh_token: 'r_' + usr.id, expires_in: 3600, user: { id: usr.id, email: b.email } });
  }
  if (u.pathname === '/auth/v1/logout') return send(res, 204, '');
  if (u.pathname === '/auth/v1/user') { const uid = String(req.headers.authorization || '').replace('Bearer tok_', ''); return send(res, 200, { id: uid, email: Object.keys(users).find(k => users[k].id === uid) }); }
  try {
    const r = await fake.fetch('https://fake-project.supabase.test' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : (/json/.test(ctype) ? raw.toString() : raw) });
    const buf = Buffer.from(await r.arrayBuffer()); res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(buf);
  } catch (e) { res.destroy(); }
}).listen(+process.argv[2] || 8799, '127.0.0.1'); }
