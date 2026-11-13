'use strict';
const { redis, send, deny, body, cfg, saveCfg } = require('./_lib');
/* The lesson's content, kept in the database so the teacher can change it: edits of the question bank, new / hidden questions,
   replacements for texts on screen, game difficulty and challenge bonuses.
   GET (public): the whole content (students fetch it when the version in their settings changes).
   POST (teacher): one operation at a time — q (edit a question), qhide, qadd, qdel, qreset, tx (a text replacement), gm, ch, reset. */
const MAX = 300000, TP = /^[a-z]{1,2}$/;
const S = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);
const EMPTY = () => ({ v: 0, nid: 1000, qo: {}, qh: [], qn: [], tx: {}, gm: {}, ch: {} });
async function load() { let o = null; try { const r = await redis(['GET', 'mf:content']); if (r) o = JSON.parse(r); } catch (e) { if (e.code === 'no_db') throw e; } return Object.assign(EMPTY(), o || {}); }
async function save(c) {
  c.v = Date.now(); const s = JSON.stringify(c); if (s.length > MAX) return null;
  await redis(['SET', 'mf:content', s]);
  const g = await cfg(true); g.ct = c.v; await saveCfg(g); return c;
}
function arr(a, n, f) { return (Array.isArray(a) ? a : []).slice(0, n).map(f); }
/* only the fields a question may change, cleaned */
function cleanQ(p, t) {
  const o = {};
  if ('q' in p) o.q = S(p.q, 300); if ('e' in p) o.e = S(p.e, 300); if ('h' in p) o.h = S(p.h, 200);
  if ('lv' in p && [1, 2, 3].includes(+p.lv)) o.lv = +p.lv; if ('tp' in p && TP.test(p.tp)) o.tp = p.tp;
  if ('o' in p) { const x = arr(p.o, 5, v => S(v, 120)).filter(Boolean); if (x.length >= 2) o.o = x; }
  if ('w' in p) { const x = arr(p.w, 12, v => S(v, 40)).filter(Boolean); if (x.length >= 2) o.w = x; }
  if ('r' in p) o.r = arr(p.r, 12, v => (['v', 's', 'o'].includes(v) ? v : 's'));
  if ('a' in p) o.a = Math.max(0, Math.min(11, Math.floor(+p.a || 0)));
  return o;
}
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return send(res, 200, { ok: true, content: await load() });
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (await deny(req, res)) return;
    const b = await body(req), c = await load(), op = String(b.op || '');
    const id = Math.floor(+b.id || 0);
    if (op === 'q') { if (!id) return send(res, 400, { error: 'bad' }); const p = cleanQ(b.patch || {}); if (id >= 1000) { const i = c.qn.findIndex(x => x.id === id); if (i < 0) return send(res, 404, { error: 'none' }); Object.assign(c.qn[i], p); } else c.qo[id] = Object.assign(c.qo[id] || {}, p); }
    else if (op === 'qhide') { if (!id) return send(res, 400, { error: 'bad' }); c.qh = c.qh.filter(x => x !== id); if (b.on) c.qh.push(id); }
    else if (op === 'qreset') { delete c.qo[id]; }
    else if (op === 'qadd') {
      const p = cleanQ(b.q || {}), o = p.o || [];
      if (!p.q || o.length < 2 || !('a' in p) || p.a >= o.length) return send(res, 400, { error: 'bad_q' });
      if (c.qn.length >= 150) return send(res, 400, { error: 'too_many' });
      c.nid = (c.nid || 1000) + 1; c.qn.push({ id: c.nid, t: 'mcq', tp: p.tp || 's', lv: p.lv || 1, q: p.q, o, a: p.a, e: p.e || '', h: p.h || '' });
    }
    else if (op === 'qdel') { c.qn = c.qn.filter(x => x.id !== id); }
    else if (op === 'tx') {
      const from = S(b.from, 400), to = S(b.to, 400); if (from.length < 2) return send(res, 400, { error: 'bad' });
      if (!to || to === from) delete c.tx[from]; else { if (Object.keys(c.tx).length >= 400 && !(from in c.tx)) return send(res, 400, { error: 'too_many' }); c.tx[from] = to; }
    }
    else if (op === 'gm') { const g = {}; ['hop', 'boss', 'final'].forEach(k => { const v = String((b.gm || {})[k] || 'auto'); g[k] = ['auto', '1', '2', '3'].includes(v) ? v : 'auto'; }); c.gm = g; }
    else if (op === 'ch') { const h = b.ch || {}; c.ch = { dailyBonus: Math.max(0, Math.min(30, Math.floor(+h.dailyBonus) || 0)), dailyPerfect: Math.max(0, Math.min(30, Math.floor(+h.dailyPerfect) || 0)) }; if (h.dailyBonus === undefined) delete c.ch.dailyBonus; if (h.dailyPerfect === undefined) delete c.ch.dailyPerfect; }
    else if (op === 'reset') { const w = String(b.what || ''); const e = EMPTY(); if (w === 'all') { c.qo = e.qo; c.qh = e.qh; c.qn = e.qn; c.tx = e.tx; c.gm = e.gm; c.ch = e.ch; } else if (['qo', 'qh', 'qn', 'tx', 'gm', 'ch'].includes(w)) c[w] = e[w]; }
    else return send(res, 400, { error: 'bad_op' });
    if (!(await save(c))) return send(res, 400, { error: 'too_big' });
    return send(res, 200, { ok: true, content: c });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
