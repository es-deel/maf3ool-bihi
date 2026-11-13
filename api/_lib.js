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
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = ''; for await (const ch of req) { s += ch; if (s.length > 5000) break; }
  try { return JSON.parse(s || '{}'); } catch (e) { return {}; }
}
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
module.exports = { parseCode, nameKey, normCls, redis, dbConf, body, send };
