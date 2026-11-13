'use strict';
const { redis, send, deny, body, cfg, saveCfg } = require('./_lib');
/* The lesson's content, kept in the database so the teacher can change it: edits of the question bank, new / hidden questions,
   replacements for texts on screen, game difficulty and challenge bonuses.
   GET (public): the whole content (students fetch it when the version in their settings changes).
   POST (teacher): one operation at a time — q (edit a question), qhide, qadd, qdel, qreset, tx (a text replacement), gm, ch, reset. */
const MAX = 300000, TP = /^[a-z]{1,2}$/;
const S = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);
const EMPTY = () => ({ v: 0, nid: 1000, qo: {}, qh: [], qn: [], tx: {}, gm: {}, ch: {}, nm: {}, gd: {} });
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
      const t = ['mcq', 'tap', 'order'].includes(b.t) ? b.t : 'mcq', p = cleanQ(b.q || {}), o = p.o || [];
      if (!p.q) return send(res, 400, { error: 'bad_q' });
      if (c.qn.length >= 150) return send(res, 400, { error: 'too_many' });
      let nq;
      if (t === 'mcq') { if (o.length < 2 || !('a' in p) || p.a >= o.length) return send(res, 400, { error: 'bad_q' }); nq = { t, o, a: p.a, h: p.h || '' }; }
      else if (t === 'tap') { const w = p.w || []; if (w.length < 2 || !('a' in p) || p.a >= w.length) return send(res, 400, { error: 'bad_q' }); nq = { t, w, a: p.a, roles: null, roleKey: S(b.roleKey, 2) || null }; }
      else { const w = p.w || [], r = (p.r || []).slice(0, w.length); if (w.length < 2 || r.length !== w.length) return send(res, 400, { error: 'bad_q' }); nq = { t, w, r }; }
      c.nid = (c.nid || 1000) + 1; c.qn.push(Object.assign({ id: c.nid, tp: p.tp || 's', lv: p.lv || 1, q: p.q, e: p.e || '' }, nq));
    }
    else if (op === 'qdel') { c.qn = c.qn.filter(x => x.id !== id); }
    else if (op === 'tx') {
      const from = S(b.from, 400), to = S(b.to, 400); if (from.length < 2) return send(res, 400, { error: 'bad' });
      if (!to || to === from) delete c.tx[from]; else { if (Object.keys(c.tx).length >= 400 && !(from in c.tx)) return send(res, 400, { error: 'too_many' }); c.tx[from] = to; }
    }
    else if (op === 'gm') { const g = {}; ['hop', 'boss', 'final'].forEach(k => { const v = String((b.gm || {})[k] || 'auto'); g[k] = ['auto', '1', '2', '3'].includes(v) ? v : 'auto'; }); c.gm = g; }
    else if (op === 'ch') { const h = b.ch || {}; c.ch = { dailyBonus: Math.max(0, Math.min(30, Math.floor(+h.dailyBonus) || 0)), dailyPerfect: Math.max(0, Math.min(30, Math.floor(+h.dailyPerfect) || 0)) }; if (h.dailyBonus === undefined) delete c.ch.dailyBonus; if (h.dailyPerfect === undefined) delete c.ch.dailyPerfect; }
    else if (op === 'nm') {   // a name / title replacement: key like tab.sentence.title
      const k = S(b.k, 60), v = S(b.v, 200); if (!/^[a-z]+\.[A-Za-z0-9_]+\.[a-z]+$/.test(k)) return send(res, 400, { error: 'bad' });
      if (!v) delete c.nm[k]; else c.nm[k] = v;
    }
    else if (op === 'gd') {   // data of a game: det = detective cases, mw = meteor rounds' words (null/[] puts the original back)
      const w = String(b.game || '');
      if (w === 'det') {
        if (!Array.isArray(b.data) || !b.data.length) delete c.gd.det; else c.gd.det = b.data.slice(0, 8).map(x => ({ t: S(x.t, 40) || 'قضية', lv: Math.max(1, Math.min(3, Math.floor(+x.lv) || 1)), sec: Math.max(20, Math.min(180, Math.floor(+x.sec) || 60)), w: arr(x.w, 40, y => [S(y[0], 30), ['v', 's', 'o', 'j', 'm'].includes(y[1]) ? y[1] : 'j', ['.', '،', ''].includes(y[2]) ? y[2] : '']).filter(y => y[0]) })).filter(x => x.w.filter(y => y[1] === 'o').length >= 1 && x.w.length >= 3);
        if (c.gd.det && !c.gd.det.length) delete c.gd.det;
      } else if (w === 'mw') {
        if (!Array.isArray(b.data) || !b.data.length) delete c.gd.mw; else c.gd.mw = b.data.slice(0, 4).map(x => arr(x, 40, y => [S(y[0], 30), ['verb', 'mufrad', 'muthanna', 'jms', 'jfs', 'taksir'].includes(y[1]) ? y[1] : 'mufrad', ['r', 'a'].includes(y[2]) ? y[2] : '']).filter(y => y[0]));
      } else if (w === 'fl') {   // «المفعول الهارب»: sentences, the object word starts with *
        const L = arr(b.data, 40, x => S(x, 120)).filter(x => x.split(' ').length >= 2 && x.split(' ').filter(y => y[0] === '*').length <= 1 && x.replace(/\*/g, '').trim());
        if (!Array.isArray(b.data) || !b.data.length) delete c.gd.fl; else if (L.length < 4 || !L.some(x => x.includes('*'))) return send(res, 400, { error: 'few' }); else c.gd.fl = L;
      } else if (w === 'fx') {   // «ورشة التصحيح»: [sentence, wrong word, right word, explanation]
        const L = arr(b.data, 30, x => [S(x && x[0], 120), S(x && x[1], 30), S(x && x[2], 30), S(x && x[3], 160)]).filter(x => x[0] && x[1] && x[2] && x[1] !== x[2] && x[0].split(' ').includes(x[1]));
        if (!Array.isArray(b.data) || !b.data.length) delete c.gd.fx; else if (L.length < 3) return send(res, 400, { error: 'few' }); else c.gd.fx = L;
      } else if (w === 'bd') {   // «ابنِ جملتك»: rounds of {v: verbs, s: subjects, o: objects, x: distractors}
        const W = a => arr(a, 4, y => S(y, 30).replace(/\s+/g, '')).filter(Boolean);
        const L = arr(b.data, 12, x => ({ v: W(x && x.v), s: W(x && x.s), o: W(x && x.o), x: W(x && x.x).slice(0, 3) })).filter(x => x.v.length && x.s.length && x.o.length);
        if (!Array.isArray(b.data) || !b.data.length) delete c.gd.bd; else if (L.length < 2) return send(res, 400, { error: 'few' }); else c.gd.bd = L;
      } else return send(res, 400, { error: 'bad' });
    }
    else if (op === 'reset') { const w = String(b.what || ''); const e = EMPTY(); if (w === 'all') { c.qo = e.qo; c.qh = e.qh; c.qn = e.qn; c.tx = e.tx; c.gm = e.gm; c.ch = e.ch; c.nm = e.nm; c.gd = e.gd; } else if (['qo', 'qh', 'qn', 'tx', 'gm', 'ch', 'nm', 'gd'].includes(w)) c[w] = e[w]; }
    else return send(res, 400, { error: 'bad_op' });
    if (!(await save(c))) return send(res, 400, { error: 'too_big' });
    return send(res, 200, { ok: true, content: c });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
