'use strict';
/* shared helpers: result-code validation (same rules as the page) + Upstash Redis REST */
const b64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function H(s) { s = 'mfr1·' + s; let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0).toString(36).padStart(7, '0').slice(-6); }
function parseCode(code) {
  const m = String(code || '').match(/^MFR1\.([A-Za-z0-9_-]{6,1500})\.([0-9a-z]{6})$/);
  if (!m || H(m[1]) !== m[2]) return null;
  let a; try { a = JSON.parse(b64u(m[1]).toString('utf8')); } catch (e) { return null; }
  if (!Array.isArray(a) || (a.length !== 28 && a.length !== 30) || a[0] !== 1 || typeof a[1] !== 'string') return null;
  const name = a[1].replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!name) return null;
  const v = a.slice(2); if (!v.every(x => Number.isInteger(x) && x >= 0 && x <= 1e9)) return null;
  const [t, pts, max, stars, smax, done, total, n, c] = v;
  if (t < 2e7 || t > 8e7 || max < 1 || max > 9999 || pts > max || smax < 1 || smax > 999 || stars > smax || total < 1 || total > 99 || done > total || c > n || n > 1e6) return null;
  return { name, t, pts };
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
  t = t.replace(/^00/, ''); if (/^20(1[0-9]{9})$/.test(t)) t = '0' + t.slice(2);
  return t.length >= 8 && t.length <= 15 ? t : '';
}
const normName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const DEFAULT_CLASSES = ['الخامس أ', 'الخامس ب', 'الخامس ج', 'الخامس د'];
async function classes() { try { const v = await redis(['GET', 'mf:classes']); const a = v ? JSON.parse(v) : null; if (Array.isArray(a) && a.length) return a.map(String); } catch (e) { if (e.code === 'no_db') throw e; } return DEFAULT_CLASSES; }
const aidOf = (phone, name) => phone + '~' + nameKey(name);
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = ''; for await (const ch of req) { s += ch; if (s.length > 5000) break; }
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
/* ---------- game settings the teacher controls (applied to every student's page within ~40 s) ---------- */
const CFG0 = { v: 0, notice: '', lock: [], pause: false, pauseMsg: '', reg: true, hints: true, cheer: '', cheerAt: 0 };
let cfgCache = { at: 0, v: CFG0 };
async function cfg(fresh) {
  if (!fresh && Date.now() - cfgCache.at < 8000) return cfgCache.v;
  let o = {}; try { const r = await redis(['GET', 'mf:cfg']); if (r) o = JSON.parse(r); } catch (e) { if (e.code === 'no_db') throw e; }
  cfgCache = { at: Date.now(), v: Object.assign({}, CFG0, o) }; return cfgCache.v;
}
function cleanCfg(b, old) {
  const t = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n), c = Object.assign({}, old);
  if ('notice' in b) c.notice = t(b.notice, 200);
  if ('pauseMsg' in b) c.pauseMsg = t(b.pauseMsg, 120);
  if ('lock' in b) c.lock = (Array.isArray(b.lock) ? b.lock : []).map(x => t(x, 20)).filter(x => /^[a-z]{2,20}$/.test(x)).slice(0, 20);
  ['pause', 'reg', 'hints'].forEach(k => { if (k in b) c[k] = !!b[k]; });
  if (b.cheer) { c.cheer = t(b.cheer, 100); c.cheerAt = Date.now(); }
  c.v = Date.now(); return c;
}
async function saveCfg(c) { await redis(['SET', 'mf:cfg', JSON.stringify(c)]); cfgCache = { at: Date.now(), v: c }; return c; }
const qs = (req, k) => (req.query && req.query[k]) || new URL(req.url, 'http://x').searchParams.get(k);
const ip = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 45) || 'x';
module.exports = { parseCode, nameKey, normCls, redis, pipeline, h2o, normPhone, normName, classes, aidOf, DEFAULT_CLASSES, dbConf, body, send, deny, qs, hashPw, checkPw, userKey, same, newToken, cfg, cleanCfg, saveCfg, ip, TOKEN_TTL };
