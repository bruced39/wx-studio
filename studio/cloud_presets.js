/* WX Studio cloud presets — Supabase Auth + per-user row-level security.
   Cloud sync is optional. The server injects a PUBLIC publishable key from
   Streamlit secrets; no service-role secret or private token ships to browsers.
   Cloud reads/writes are only possible for a signed-in Supabase Auth user. */
(function (g) {
  'use strict';
  const cfg = g.WX_CLOUD_CONFIG || {};
  const url = String(cfg.url || '').replace(/\/+$/, '');
  const key = String(cfg.publishableKey || '');
  const KEY = 'wx.studio.cloudAuth.v1';
  let session = null, initialized = false, lastUid = null;
  const authListeners = [];
  /* Additive (v0.10.2): onAuthChange(fn) -> unsubscribe. fn({event:'signed-in'|'signed-out'|'user-changed', userId, previousUserId, reason}) fires only when the
     signed-in USER changes (token refreshes do not fire). Listener errors never affect authentication. */
  function authChanged(reason) {
    const uid = session?.user?.id || null;
    if (uid === lastUid) return;
    const prev = lastUid; lastUid = uid;
    const event = !uid ? 'signed-out' : (prev ? 'user-changed' : 'signed-in');
    authListeners.slice().forEach(f => { try { f({event, userId: uid, previousUserId: prev, reason: reason || ''}); } catch (e) { /* ignore */ } });
  }
  const onAuthChange = (fn) => { if (typeof fn !== 'function') return () => {}; authListeners.push(fn); return () => { const i = authListeners.indexOf(fn); if (i >= 0) authListeners.splice(i, 1); }; };
  const configured = () => /^https:\/\/[a-z0-9.-]+$/i.test(url) && !!key;
  const parse = (raw) => { try { return JSON.parse(raw); } catch (e) { return null; } };
  const store = (s) => {
    session = s || null;
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch (e) { /* browser storage can be disabled */ }
    authChanged(session ? 'session' : (storeReason || 'session-ended'));
  };
  let storeReason = '';
  const expiredSoon = () => !session || !session.access_token ||
    (session.expires_at && session.expires_at < Date.now() + 45000);
  const baseHeaders = () => ({ 'apikey': key, 'Content-Type': 'application/json' });
  async function call(path, opts) {
    if (!configured()) throw Error('Cloud presets are not configured in Streamlit secrets.');
    const response = await fetch(url + path, opts);
    const txt = await response.text();
    const data = txt ? parse(txt) : null;
    if (!response.ok) {
      const err = data?.msg || data?.message || data?.error_description || data?.error || ('HTTP ' + response.status);
      throw Error(String(err));
    }
    return data;
  }
  function saveAuthResult(data) {
    if (!data?.access_token || !data?.refresh_token) throw Error('Authentication did not return a session.');
    const expires = +data.expires_in || 3600;
    store({ access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Date.now() + expires * 1000,
      user: data.user || session?.user || null });
  }
  async function refresh() {
    if (!session?.refresh_token) { store(null); return false; }
    try {
      const data = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: baseHeaders(),
        body: JSON.stringify({refresh_token: session.refresh_token})
      });
      saveAuthResult(data);
      return true;
    } catch (e) {
      store(null); return false;
    }
  }
  async function ensureSession() {
    if (!initialized) await initialize();
    if (!session) return null;
    if (expiredSoon() && !(await refresh())) return null;
    if (!session?.user?.id) {
      try {
        const user = await call('/auth/v1/user', {
          headers: { ...baseHeaders(), Authorization: 'Bearer ' + session.access_token }
        });
        session.user = user;
        store(session);
      } catch (e) { store(null); return null; }
    }
    return session;
  }
  async function initialize() {
    if (initialized) return session;
    initialized = true;
    if (!configured()) return null;
    session = parse((() => { try { return localStorage.getItem(KEY); } catch(e) { return null; } })());
    if (expiredSoon()) await refresh();
    authChanged('restored');
    return session;
  }
  async function signIn(email, password) {
    const data = await call('/auth/v1/token?grant_type=password', {
      method: 'POST', headers: baseHeaders(), body: JSON.stringify({email, password})
    });
    saveAuthResult(data);
    return session.user;
  }
  async function signUp(email, password) {
    const data = await call('/auth/v1/signup', {
      method: 'POST', headers: baseHeaders(), body: JSON.stringify({email, password})
    });
    if (data?.access_token) saveAuthResult(data);
    return {signedIn: !!data?.access_token, confirmationRequired: !data?.access_token};
  }
  async function signOut() {
    if (session?.access_token) {
      try {
        await call('/auth/v1/logout', {
          method: 'POST', headers: {...baseHeaders(), Authorization: 'Bearer ' + session.access_token}
        });
      } catch(e) { /* always clear local auth even if network is down */ }
    }
    storeReason = 'user'; try { store(null); } finally { storeReason = ''; }
  }
  async function rowRequest(path, opts={}) {
    const auth = await ensureSession();
    if (!auth?.user?.id) throw Error('Sign in to sync cloud presets.');
    const headers = {
      ...baseHeaders(), Authorization: 'Bearer ' + auth.access_token,
      Prefer: opts.prefer || 'return=representation'
    };
    return call('/rest/v1/wx_studio_map_presets' + path, {
      method: opts.method || 'GET', headers,
      ...(opts.body ? {body: JSON.stringify(opts.body)} : {})
    });
  }
  async function list() {
    const rows = await rowRequest('?select=id,name,settings,camera,created_at,updated_at&order=updated_at.desc&limit=1000');
    return (Array.isArray(rows) ? rows : []).map(x => ({
      id:x.id, name:x.name, settings:x.settings||{}, camera:x.camera||null,
      created:x.created_at, updated:x.updated_at
    }));
  }
  async function save(item) {
    const auth = await ensureSession();
    if (!auth?.user?.id) throw Error('Sign in to sync cloud presets.');
    const name = String(item?.name||'').trim();
    if (!name || name.length > 100) throw Error('Preset names must be 1 to 100 characters.');
    const payload = { user_id: auth.user.id, name,
      settings: item.settings || {}, camera: item.camera || null,
      updated_at: new Date().toISOString() };
    return rowRequest('?on_conflict=user_id,name', {
      method:'POST', prefer:'resolution=merge-duplicates,return=representation',
      body:payload
    });
  }
  async function remove(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id||''))) throw Error('Invalid preset ID');
    return rowRequest('?id=eq.' + encodeURIComponent(id), {
      method:'DELETE', prefer:'return=minimal'
    });
  }
  g.WXCloudPresets = Object.freeze({
    configured, initialize, ensureSession, signIn, signUp, signOut, list, save, remove,
    user: () => session?.user || null, onAuthChange
  });
})(typeof window !== 'undefined' ? window : globalThis);
