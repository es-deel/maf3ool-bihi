'use strict';
/* shared helpers: result-code validation (same rules as the page) + Upstash Redis REST */
const b64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function H(s) { s = 'mfr1·' + s; let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0).toString(36).padStart(7, '0').slice(-6); }
function parseCode(code) {
  const m = String(code || '').match(/^MFR1\.([A-Za-z0-9_-]{6,1500})\.([0-9a-z]{6})$/);
  if (!m || H(m[1]) !== m[2]) return null;
  let a; try { a = JSON.parse(b64u(m[1]).toString('utf8')); } catch (e) { return null; }
  if (!Array.isArray(a) || (a.length !== 28 && a.length !== 30 && a.length !== 34 && a.length !== 40) || a[0] !== 1 || typeof a[1] !== 'string') return null;
  const name = a[1].replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!name) return null;
  const v = a.slice(2); if (!v.every(x => Number.isInteger(x) && x >= 0 && x <= 1e9)) return null;
  const [t, pts, max, stars, smax, done, total, n, c] = v;
  if (t < 2e7 || t > 8e7 || max < 1 || max > 9999 || pts > max || smax < 1 || smax > 999 || stars > smax || total < 1 || total > 99 || done > total || c > n || n > 1e6) return null;
  return { name, t, pts, max, stars, n, c };
}
const nameKey = n => String(n).replace(/[ً-ٰ؟ـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
const normCls = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9؀-ۿ\- ]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
function dbConf() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}
async function redis(cmd) {
  const c = dbConf(); if (!c) { const e = new Error('no_db'); e.code = 'no_db'; throw e; }
  const r = await fetch(c.url, { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'redis ' + r.status); return j.result;
}
/* several commands in one round trip */
async function pipeline(cmds) {
  const c = dbConf(); if (!c) { const e = new Error('no_db'); e.code = 'no_db'; throw e; }
  const r = await fetch(c.url.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  const j = await r.json(); if (!r.ok || !Array.isArray(j)) throw new Error('pipeline ' + r.status);
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const h2o = a => { const o = {}; for (let i = 0; a && i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; return o; };
/* a phone number: Arabic or Persian digits are accepted, +20 / 0020 become the local form, 8-15 digits */
function normPhone(s) {
  let t = String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, '');
  t = t.replace(/^00/, '');
  if (/^20(1[0-9]{9})$/.test(t)) t = '0' + t.slice(2);          // +20 1x… (Egypt)  -> 01x…
  else if (/^966(5[0-9]{8})$/.test(t)) t = '0' + t.slice(3);    // +966 5x… (Saudi) -> 05x…
  else if (/^1[0125][0-9]{8}$/.test(t)) t = '0' + t;            // 1x… without the leading 0 (Egypt)
  else if (/^5[0-9]{8}$/.test(t)) t = '0' + t;                  // 5x… without the leading 0 (Saudi)
  return t.length >= 8 && t.length <= 15 ? t : '';
}
/* the number with its country code, ready for WhatsApp: 01x… -> Egypt (20), 05x… -> Saudi Arabia (966) */
function intlPhone(p) { p = String(p || '').replace(/\D/g, ''); if (/^01[0125][0-9]{8}$/.test(p)) return '20' + p.slice(1); if (/^05[0-9]{8}$/.test(p)) return '966' + p.slice(1); return p.replace(/^0+/, ''); }
const normName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const DEFAULT_CLASSES = ['الخامس أ', 'الخامس ب', 'الخامس ج', 'الخامس د'];
async function classes() { try { const v = await redis(['GET', 'mf:classes']); const a = v ? JSON.parse(v) : null; if (Array.isArray(a) && a.length) return a.map(String); } catch (e) { if (e.code === 'no_db') throw e; } return DEFAULT_CLASSES; }
const aidOf = (phone, name) => phone + '~' + nameKey(name);
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = ''; for await (const ch of req) { s += ch; if (s.length > 400000) break; }
  try { return JSON.parse(s || '{}'); } catch (e) { return {}; }
}
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
const crypto = require('crypto');
/* ---------- teacher accounts: user name + password stored (hashed) in the database; a login gives a token valid for 7 days ---------- */
const hashPw = (pw, salt) => { salt = salt || crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); };
const checkPw = (pw, stored) => { const [salt, h] = String(stored || '').split(':'); if (!salt || !h) return false; const x = Buffer.from(h, 'hex'), y = crypto.scryptSync(String(pw), salt, 32); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const userKey = u => String(u || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '').slice(0, 30);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const TOKEN_TTL = 7 * 24 * 3600;
async function newToken(user) { const t = crypto.randomBytes(24).toString('hex'); await redis(['SET', 'mf:tok:' + t, user, 'EX', String(TOKEN_TTL)]); return t; }
/* returns null when allowed (req.teacher = user name), otherwise sends the error and returns true */
async function deny(req, res) {
  const t = String(req.headers['x-tok'] || '').replace(/[^0-9a-f]/g, '').slice(0, 64);
  if (t.length < 32) { send(res, 401, { error: 'login' }); return true; }
  try { const u = await redis(['GET', 'mf:tok:' + t]); if (!u) { send(res, 401, { error: 'login' }); return true; } req.teacher = u; return false; }
  catch (e) { send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); return true; }
}
/* ---------- game settings the teacher controls (applied to every student's page within ~30 s) ----------
   global keys: reg, hints, boardHide[] (students kept off the honour board), boardSeason {id,t,from}, boardHall[] (past seasons' winners)
   scoped keys (global, or overridden for one class in byCls[class]): notice, pause, pauseMsg, lock[], cheer + cheerAt,
   board ('off' | 'top3' | 'top5' | 'top10' | 'all'), boardBy ('pct' | 'pts' | 'stars'), boardNames ('first' | 'full' | 'initial'), boardTitle, boardMotto */
const SCOPED = ['notice', 'pause', 'pauseMsg', 'lock', 'hide', 'gamesOff', 'cheer', 'cheerAt', 'board', 'boardBy', 'boardNames', 'boardTitle', 'boardMotto'];
const CFG0 = { v: 0, ct: 0, notice: '', lock: [], pause: false, pauseMsg: '', hide: [], gamesOff: [], reg: true, hints: true, sound: true, fx: true, win: { on: false, from: '08:00', to: '14:00' }, rep: {}, cheer: '', cheerAt: 0, board: 'off', boardBy: 'pct', boardNames: 'first', boardTitle: '', boardMotto: '', boardHide: [], boardSeason: null, boardHall: [], byCls: {} };
let cfgCache = { at: 0, v: CFG0 };
async function cfg(fresh) {
  if (!fresh && Date.now() - cfgCache.at < 8000) return cfgCache.v;
  let o = {}; try { const r = await redis(['GET', 'mf:cfg']); if (r) o = JSON.parse(r); } catch (e) { if (e.code === 'no_db') throw e; }
  cfgCache = { at: Date.now(), v: Object.assign({}, CFG0, o) }; return cfgCache.v;
}
const tx = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
function cleanScoped(b, c) {
  if ('notice' in b) c.notice = tx(b.notice, 200);
  if ('pauseMsg' in b) c.pauseMsg = tx(b.pauseMsg, 120);
  const ids = v => (Array.isArray(v) ? v : []).map(x => tx(x, 20)).filter(x => /^[a-z0-9]{2,20}$/.test(x)).slice(0, 24);
  if ('lock' in b) c.lock = ids(b.lock);
  if ('hide' in b) c.hide = ids(b.hide);
  if ('gamesOff' in b) c.gamesOff = ids(b.gamesOff);
  if ('pause' in b) c.pause = !!b.pause;
  if (['off', 'top3', 'top5', 'top10', 'all'].includes(b.board)) c.board = b.board;
  if (['pct', 'pts', 'stars'].includes(b.boardBy)) c.boardBy = b.boardBy;
  if (['first', 'full', 'initial'].includes(b.boardNames)) c.boardNames = b.boardNames;
  if ('boardTitle' in b) c.boardTitle = tx(b.boardTitle, 40);
  if ('boardMotto' in b) c.boardMotto = tx(b.boardMotto, 100);
  if (b.cheer) { c.cheer = tx(b.cheer, 100); c.cheerAt = Date.now(); }
  return c;
}
/* b.scope: a class name changes only that class's overrides; otherwise the global values */
function cleanCfg(b, old) {
  const c = Object.assign({}, CFG0, old), scope = tx(b.scope, 24);
  c.byCls = Object.assign({}, c.byCls);
  if (scope && scope !== 'all') {
    if (b.reset) delete c.byCls[scope];
    else { if (Object.keys(c.byCls).length >= 20 && !c.byCls[scope]) return c; const o = Object.assign({}, c.byCls[scope]); if (b.boardReset) ['board', 'boardBy', 'boardNames', 'boardTitle', 'boardMotto'].forEach(k => { delete o[k]; }); c.byCls[scope] = cleanScoped(b, o); }
  } else cleanScoped(b, c);
  ['reg', 'hints', 'sound', 'fx'].forEach(k => { if (k in b) c[k] = !!b[k]; });
  if (b.win && typeof b.win === 'object') { const hm = x => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(x)) ? String(x) : null; c.win = { on: !!b.win.on, from: hm(b.win.from) || '08:00', to: hm(b.win.to) || '14:00' }; }
  if (b.rep && typeof b.rep === 'object') c.rep = cleanRep(b.rep, c.rep);
  if (Array.isArray(b.boardHide)) c.boardHide = [...new Set(b.boardHide.map(x => String(x || '').slice(0, 200)).filter(Boolean))].slice(0, 300);
  if (b.sc && typeof b.sc === 'object') c.sc = { x: b.sc.x !== false };   // whether the extra games and the last battle count in the score (otherwise they only earn the bonus)
  if (b.cert && typeof b.cert === 'object') c.cert = cleanCert(b.cert, c.cert);
  if ('wk' in b) {   // the weekly class goal: {on, t, goal, days, cls:[…]} starts a new one; {on:false} ends it
    const w = b.wk;
    if (!w || !w.on) c.wk = null;
    else c.wk = { id: Date.now().toString(36), t: tx(w.t, 60) || 'تحدّي الفصل الأسبوعي', goal: Math.max(10, Math.min(50000, Math.floor(+w.goal) || 300)), end: Date.now() + Math.max(1, Math.min(30, Math.floor(+w.days) || 7)) * 86400000, cls: (Array.isArray(w.cls) ? w.cls : []).map(x => tx(x, 24)).filter(Boolean).slice(0, 16), from: Date.now() };
  }
  c.v = Date.now(); return c;
}
const CERT_TH = ['gold', 'royal', 'emerald', 'rose', 'space'];
/* the certificate: conditions for getting it (min) and its design (d) */
function cleanCert(b, old) {
  const r = Object.assign({}, old), n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(+v) || 0));
  if ('on' in b) r.on = !!b.on;
  if (b.min && typeof b.min === 'object') { const m = Object.assign({}, r.min), x = b.min; if ('pct' in x) m.pct = n(x.pct, 0, 100); if ('stars' in x) m.stars = n(x.stars, 0, 30); if ('games' in x) m.games = n(x.games, 0, 30); if ('daily' in x) m.daily = n(x.daily, 0, 60); ['all', 'boss'].forEach(k => { if (k in x) m[k] = !!x[k]; }); r.min = m; }
  if (b.d && typeof b.d === 'object') { const d = Object.assign({}, r.d), x = b.d; [['title', 30], ['lead', 50], ['body', 220], ['honor', 40], ['teacher', 40], ['role', 40], ['school', 60]].forEach(([k, l]) => { if (k in x) d[k] = tx(x[k], l); }); if (CERT_TH.includes(x.theme)) d.theme = x.theme; ['stats', 'badges', 'bonus', 'logo'].forEach(k => { if (k in x) d[k] = !!x[k]; }); r.d = d; }
  return r;
}
const REP_SEC = ['compare', 'topics', 'heat', 'wrong', 'plan', 'notes', 'recs', 'students', 'insights'];
/* the look of the reports (teacher + student): school line, titles, footer, parent note, colour, which sections are printed */
function cleanRep(b, old) {
  const r = Object.assign({}, old);
  [['school', 60], ['teacher', 40], ['tStu', 60], ['tCls', 60], ['course', 90], ['foot', 80], ['note', 300]].forEach(([k, n]) => { if (k in b) r[k] = tx(b[k], n); });
  if ('color' in b) r.color = /^(violet|emerald|blue|amber|rose|slate)$/.test(b.color) || /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : 'violet';
  if (b.sec && typeof b.sec === 'object') { r.sec = Object.assign({}, r.sec); REP_SEC.forEach(k => { if (k in b.sec) r.sec[k] = !!b.sec[k]; }); }
  if ('logoV' in b) r.logoV = Math.floor(+b.logoV || 0);
  return r;
}
/* what one student's page receives: the global values with his class's overrides on top */
function eff(c, cls) {
  const o = c.byCls && cls ? c.byCls[cls] || {} : {}, r = { v: c.v, reg: c.reg !== false, hints: c.hints !== false, sound: c.sound !== false, fx: c.fx !== false, win: c.win || CFG0.win, rep: c.rep || {}, ct: c.ct || 0, sc: c.sc || { x: true }, cert: c.cert || null };
  SCOPED.forEach(k => { r[k] = k in o ? o[k] : c[k]; });
  r.board = r.board || 'off'; r.boardBy = r.boardBy || 'pct'; r.boardNames = r.boardNames || 'first'; r.boardTitle = r.boardTitle || ''; r.boardMotto = r.boardMotto || '';
  r.bseason = c.boardSeason && c.boardSeason.id ? { id: c.boardSeason.id, t: c.boardSeason.t, from: c.boardSeason.from } : null;
  if ((o.cheerAt || 0) < (c.cheerAt || 0)) { r.cheer = c.cheer; r.cheerAt = c.cheerAt; }
  { const w = c.wk; if (w && w.id && w.end > Date.now() && (!w.cls || !w.cls.length || !cls || w.cls.includes(cls))) r.wk = { id: w.id, t: w.t, goal: w.goal, end: w.end }; }
  return r;
}
/* ---------- the class honour board ---------- */
const BOARD_TOP = { top3: 3, top5: 5, top10: 10, all: 60 };
const boardName = (n, mode) => { n = String(n || ''); const w = n.split(' ').filter(Boolean); if (mode === 'full') return n; if (mode === 'initial' && w.length > 1) return w[0] + ' ' + w[w.length - 1][0] + '.'; return w[0] || n; };
/* every student of one class that has sent a valid result code */
async function classRows(cls) {
  const rows = h2o((await redis(['HGETALL', 'mf:cls:' + cls])) || []), L = [];
  Object.keys(rows).forEach(k => { let r = {}; try { r = JSON.parse(rows[k]); } catch (e) { } const x = r.c ? parseCode(r.c) : null; if (x) L.push({ k, n: r.n || x.name, p: x.pts, m: x.max, s: x.stars, a: x.n ? x.c / x.n : 0 }); });
  return L;
}
/* ranks them: 'season' counts only the points earned since the season began (base = {aid: points then}); otherwise by percentage, points or stars */
function rankRows(L, by, season, base) {
  const R = L.map(x => { const sp = Math.max(0, x.p - (+(base && base[x.k]) || 0)); return Object.assign({}, x, { sp, pct: Math.round(x.p * 1000 / x.m) / 10, v: season ? sp : by === 'pts' ? x.p : by === 'stars' ? x.s : Math.round(x.p * 1000 / x.m) / 10 }); });
  R.sort((a, b) => b.v - a.v || b.p / b.m - a.p / a.m || b.s - a.s || b.a - a.a || a.n.localeCompare(b.n, 'ar'));
  return R;
}
async function seasonBase() { return h2o((await redis(['HGETALL', 'mf:bs'])) || []); }
async function saveCfg(c) { await redis(['SET', 'mf:cfg', JSON.stringify(c)]); cfgCache = { at: Date.now(), v: c }; return c; }
/* a rate limit: true when this key has been hit more than max times in 10 minutes */
async function limited(key, max) { const n = await redis(['INCR', key]); await redis(['EXPIRE', key, '600']); return n > max; }
const qs = (req, k) => (req.query && req.query[k]) || new URL(req.url, 'http://x').searchParams.get(k);
const ip = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 45) || 'x';
module.exports = { parseCode, nameKey, normCls, redis, pipeline, h2o, normPhone, intlPhone, normName, classes, aidOf, DEFAULT_CLASSES, dbConf, body, send, deny, qs, hashPw, checkPw, userKey, same, newToken, cfg, cleanCfg, saveCfg, eff, limited, ip, TOKEN_TTL, classRows, rankRows, boardName, seasonBase, BOARD_TOP };
