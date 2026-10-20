'use strict';
/* Runs the REAL WX Studio v0.10.2 SQL migrations (ChatGPT's supabase/migrations/20261020*) in a throw-away local PostgreSQL and exposes them through
 * a fetch() that behaves like Supabase for the calls the client makes: PostgREST RPCs and table SELECTs (executed as the `authenticated` role with
 * row-level security and the migration's GRANTs in force), the private wx-studio-media bucket (the migration's storage.objects policies + bucket
 * size/MIME limits are enforced) and fake email/password auth. It is NOT Supabase (no PostgREST, no real Storage service, no GoTrue) — it checks
 * that the client matches the real database objects and policies. Real two-computer testing against the live project is still required.
 *
 *   const pg = await createPgSupabase({ migrations: '<dir with the *.sql files>' });   // null when PostgreSQL binaries are unavailable
 *   pg.fetch(url, opts) · pg.token(uid) · pg.query(sql) (superuser, returns text rows) · pg.faults · pg.failNext · pg.dropResponseNext · await pg.close()   */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/bin'].find(d => fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'pg_ctl')));
const USERS = { 'a@x.test': '00000000-0000-4000-8000-00000000000a', 'b@x.test': '00000000-0000-4000-8000-00000000000b' };
const SIG = {
  wx_studio_save_show: { p_show_id: 'uuid', p_base_rev: 'integer', p_doc: 'jsonb', p_device_id: 'text', p_device_name: 'text', p_reason: 'text', p_schema_version: 'integer', p_op_id: 'uuid', p_meta: 'jsonb' },
  wx_studio_delete_show: { p_show_id: 'uuid', p_base_rev: 'integer', p_device_id: 'text' },
  wx_studio_undelete_show: { p_show_id: 'uuid', p_base_rev: 'integer' },
  wx_studio_save_settings: { p_patch: 'jsonb', p_device_id: 'text' },
  wx_studio_set_workspace: { p_device_id: 'text', p_device_name: 'text', p_show_id: 'uuid', p_scene_id: 'text' },
  wx_studio_register_media: { p_sha256: 'text', p_kind: 'text', p_mime: 'text', p_size_bytes: 'bigint', p_name: 'text', p_width: 'integer', p_height: 'integer' }
};
const TABLES = ['wx_studio_shows', 'wx_studio_show_versions', 'wx_studio_user_settings', 'wx_studio_workspace', 'wx_studio_media'];
const q = s => { const tag = '$q' + nodeCrypto.randomBytes(4).toString('hex') + '$'; return tag + String(s) + tag; };
const lit = (v, type) => {
  if (v === null || v === undefined) return 'NULL::' + type;
  if (type === 'integer' || type === 'bigint') { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('invalid input syntax for type ' + type); return String(v) + '::' + type; }
  if (type === 'jsonb') return q(JSON.stringify(v)) + '::jsonb';
  return q(String(v)) + '::' + type;
};

class Psql {
  constructor(sock, port, db) {
    this.p = spawn('sh', ['-c', `exec psql -X -q -A -t -v ON_ERROR_STOP=0 -h '${sock}' -p ${port} -U postgres -d ${db} 2>&1`], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = ''; this.wait = null; this.chain = Promise.resolve(); this.n = 0;
    this.p.stdout.on('data', d => { this.buf += d; this.pump(); });
  }
  pump() { if (!this.wait) return; const s = this.buf.indexOf('@@S' + this.wait.id + '@@'), e = this.buf.indexOf('@@E' + this.wait.id + '@@'); if (s >= 0 && e > s) { const out = this.buf.slice(s + ('@@S' + this.wait.id + '@@').length, e); this.buf = this.buf.slice(e + 8); const w = this.wait; this.wait = null; w.res(out.trim()); } }
  run(sql) { const job = this.chain.then(() => new Promise(res => { const id = ++this.n; this.wait = { id, res }; this.p.stdin.write(`SELECT '@@S${id}@@';\n${sql}\n;\nSELECT '@@E${id}@@';\n`); })); this.chain = job.catch(() => { }); return job; }
  close() { try { this.p.stdin.end(); } catch (e) { /* ignore */ } }
}

async function createPgSupabase(opt) {
  opt = opt || {}; if (!BIN) return null;
  const migDir = opt.migrations || process.env.WX_MIGRATIONS_DIR || path.join(__dirname, '../../supabase/migrations');
  const migs = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter(f => /^20261020\d+_.*\.sql$/.test(f)).sort() : [];
  if (!migs.length) return null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxpg-')), data = path.join(root, 'data'), sock = path.join(root, 'sock'), port = 54000 + Math.floor(Math.random() * 900), asRoot = process.getuid && process.getuid() === 0;
  fs.mkdirSync(sock); if (asRoot) spawnSync('chown', ['-R', 'postgres', root]);
  const run = (cmd, args) => asRoot ? spawnSync('runuser', ['-u', 'postgres', '--', path.join(BIN, cmd), ...args], { encoding: 'utf8' }) : spawnSync(path.join(BIN, cmd), args, { encoding: 'utf8' });
  let r = run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres']); if (r.status !== 0) return null;
  r = run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${sock} -c listen_addresses=''`, '-l', path.join(root, 'log'), '-w', 'start']); if (r.status !== 0) return null;
  const psqlFile = f => { const x = spawnSync('psql', ['-X', '-q', '-h', sock, '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', f], { encoding: 'utf8' }); if (x.status !== 0) throw new Error('migration failed: ' + f + '\n' + x.stderr); };
  psqlFile(path.join(__dirname, 'pg_bootstrap.sql')); migs.forEach(f => psqlFile(path.join(migDir, f)));
  const sql = new Psql(sock, port, 'postgres');
  const F = { url: 'https://fake-project.supabase.test', key: 'sb_publishable_fake', calls: [], faults: { offline: false }, migrations: migs };
  const queue = [], objects = F.objects = new Map();
  F.failNext = (re, x) => queue.push({ re, kind: 'fail', status: (x && x.status) || 500, body: (x && x.body) || { message: 'fake failure' } });
  F.dropResponseNext = re => queue.push({ re, kind: 'drop' });
  F.token = uid => 'tok_' + uid;
  F.users = USERS;
  F.query = async s => sql.run(s);
  F.rows = async s => { const t = await sql.run(s); if (/ERROR:/.test(t)) throw new Error(t + '\nSQL: ' + s); return t ? t.split('\n').map(l => JSON.parse(l)) : []; };
  for (const id of Object.values(USERS)) await sql.run(`INSERT INTO auth.users(id,email) VALUES ('${id}','${id}@x.test') ON CONFLICT DO NOTHING;`);
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
  const asUser = (uid, body) => `BEGIN;\nSELECT set_config('request.jwt.claims', ${q(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);\nSET LOCAL ROLE authenticated;\n${body}\nCOMMIT;`;
  const result = out => { const err = /ERROR:\s*(.*)/.exec(out); if (err) { const m = err[1]; return { status: /permission denied|row-level security/i.test(m) ? 403 : 400, body: { message: m, code: /permission denied/.test(m) ? '42501' : 'P0001' } }; } const line = out.split('\n').filter(l => l && !/^(BEGIN|COMMIT|ROLLBACK|SET|set_config|[-+]+)$/.test(l) && !/^t$/.test(l)).pop(); return { status: 200, text: line }; };
  const exec = async (uid, body) => { const out = await sql.run(asUser(uid, body)); if (/ERROR:/.test(out)) await sql.run('ROLLBACK;'); return result(out); };

  async function rpc(uid, fn, args) {
    const sig = SIG[fn]; if (!sig) return { status: 404, body: { message: 'function ' + fn + ' not found' } };
    const parts = []; for (const k of Object.keys(args || {})) { if (!sig[k]) return { status: 404, body: { message: 'unknown parameter ' + k } }; parts.push(k + ' => ' + lit(args[k], sig[k])); }
    let r; try { r = await exec(uid, `SELECT public.${fn}(${parts.join(', ')})::text;`); } catch (e) { return { status: 400, body: { message: String(e.message) } }; }
    return r.text ? { status: 200, body: JSON.parse(r.text) } : r;
  }
  async function select(uid, table, params) {
    if (!TABLES.includes(table)) return { status: 404, body: { message: 'no such table' } };
    const cols = (params.get('select') || '*').split(',').map(s => s.trim()); if (!cols.every(c => c === '*' || /^[a-z0-9_]+$/.test(c))) return { status: 400, body: { message: 'bad select' } };
    const where = [];
    for (const [k, v] of params.entries()) {
      if (['select', 'order', 'limit'].includes(k)) continue; if (!/^[a-z0-9_]+$/.test(k)) return { status: 400, body: { message: 'bad filter' } };
      const m = /^(eq|neq|is|not\.is)\.(.*)$/.exec(v); if (!m) return { status: 400, body: { message: 'bad filter' } };
      where.push(m[1] === 'eq' ? `${k}::text = ${q(m[2])}` : m[1] === 'neq' ? `${k}::text <> ${q(m[2])}` : m[1] === 'is' ? `${k} IS ${m[2] === 'null' ? 'NULL' : 'NOT NULL'}` : `${k} IS ${m[2] === 'null' ? 'NOT NULL' : 'NULL'}`);
    }
    let ord = ''; if (params.get('order')) { const [c, d] = params.get('order').split('.'); if (!/^[a-z0-9_]+$/.test(c)) return { status: 400, body: { message: 'bad order' } }; ord = ` ORDER BY ${c} ${d === 'desc' ? 'DESC' : 'ASC'}`; }
    const lim = +params.get('limit') ? ` LIMIT ${+params.get('limit')}` : '';
    const r = await exec(uid, `SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text FROM (SELECT ${cols.join(',')} FROM public.${table}${where.length ? ' WHERE ' + where.join(' AND ') : ''}${ord}${lim}) t;`);
    return r.text ? { status: 200, body: JSON.parse(r.text) } : r;
  }
  async function storage(uid, method, p, headers, body) {
    const m = /^\/storage\/v1\/object\/(authenticated\/)?([^/]+)\/(.+)$/.exec(p); if (!m) return { status: 404, body: { message: 'bad storage path' } };
    const bucket = m[2], key = decodeURIComponent(m[3]);
    const b = (await F.rows(`SELECT to_jsonb(b) FROM storage.buckets b WHERE id=${q(bucket)};`))[0]; if (!b) return { status: 404, body: { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' } };
    if (method === 'GET') {
      const r = await exec(uid, `SELECT count(*) FROM storage.objects WHERE bucket_id=${q(bucket)} AND name=${q(key)};`);
      if (r.status !== 200 || r.text !== '1' || !objects.has(key)) return { status: 404, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } };
      return { status: 200, raw: objects.get(key).bytes, mime: objects.get(key).mime };
    }
    const mime = (headers['content-type'] || '').split(';')[0], bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (b.allowed_mime_types && !b.allowed_mime_types.includes(mime)) return { status: 415, body: { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + mime + ' is not supported' } };
    if (b.file_size_limit && bytes.length > b.file_size_limit) return { status: 413, body: { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' } };
    if (objects.has(key)) return { status: 400, body: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } };
    const r = await exec(uid, `INSERT INTO storage.objects(bucket_id,name,owner,metadata) VALUES (${q(bucket)},${q(key)},'${uid}'::uuid,${q(JSON.stringify({ size: bytes.length, mimetype: mime }))}::jsonb) RETURNING 1;`);
    if (r.status !== 200) return { status: 403, body: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } };
    objects.set(key, { bytes, mime }); return { status: 200, body: { Key: bucket + '/' + key } };
  }
  F.fetch = async function (url, opts) {
    opts = opts || {}; const u = new URL(url), headers = {}, method = (opts.method || 'GET').toUpperCase();
    for (const k of Object.keys(opts.headers || {})) headers[k.toLowerCase()] = opts.headers[k];
    F.calls.push({ method, path: u.pathname + u.search, body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined });
    if (F.faults.offline) throw new TypeError('Failed to fetch');
    const qi = queue.findIndex(x => x.re.test(u.pathname)); let dropAfter = false;
    if (qi >= 0) { const x = queue.splice(qi, 1)[0]; if (x.kind === 'fail') return json(x.body, x.status); dropAfter = true; }
    const mm = /^Bearer tok_(.+)$/.exec(headers.authorization || ''), uid = mm && Object.values(USERS).includes(mm[1]) ? mm[1] : null;
    if (!uid) return json({ message: 'Invalid or missing JWT', code: 'PGRST301' }, 401);
    let out;
    if (u.pathname.startsWith('/rest/v1/rpc/')) out = await rpc(uid, u.pathname.slice('/rest/v1/rpc/'.length), opts.body ? JSON.parse(opts.body) : {});
    else if (u.pathname.startsWith('/rest/v1/')) out = method !== 'GET' ? { status: 403, body: { code: '42501', message: 'permission denied for table' } } : await select(uid, u.pathname.slice('/rest/v1/'.length), u.searchParams);
    else if (u.pathname.startsWith('/storage/v1/')) out = await storage(uid, method, u.pathname, headers, opts.body);
    else out = { status: 404, body: { message: 'not found' } };
    if (dropAfter) throw new TypeError('Failed to fetch');
    if (out.raw) return new Response(out.raw, { status: out.status, headers: { 'content-type': out.mime } });
    return json(out.body, out.status);
  };
  F.close = async () => { sql.close(); run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* ignore */ } };
  return F;
}
module.exports = { createPgSupabase, USERS };
