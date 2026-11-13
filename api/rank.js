'use strict';
const { redis, send, body, h2o, parseCode, cfg, eff, same } = require('./_lib');
/* the class ranking a student may see (only when the teacher turned it on): computed from the results the students' pages sent */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), aid = String(b.aid || '').slice(0, 200);
  try {
    const [cls, sk] = await redis(['HMGET', 'mf:acc:' + aid, 'cls', 'sk']);
    if (!cls || !sk || !same(b.sk || '', sk)) return send(res, 401, { error: 'bad_session' });
    const c = eff(await cfg(), cls); if (c.board === 'off') return send(res, 200, { ok: true, off: true });
    const rows = h2o((await redis(['HGETALL', 'mf:cls:' + cls])) || []), L = [];
    Object.keys(rows).forEach(k => { let r = {}; try { r = JSON.parse(rows[k]); } catch (e) { } const x = r.c ? parseCode(r.c) : null; if (x) L.push({ k, n: r.n || x.name, p: x.pts, m: x.max, s: x.stars, a: x.n ? x.c / x.n : 0 }); });
    L.sort((a, b2) => b2.p / b2.m - a.p / a.m || b2.s - a.s || b2.a - a.a || a.n.localeCompare(b2.n, 'ar'));
    const pos = L.findIndex(x => x.k === aid) + 1, top = c.board === 'top5' ? 5 : c.board === 'top10' ? 10 : 50;
    const nm = n => c.boardNames === 'first' ? String(n).split(' ')[0] : n;
    const list = L.slice(0, top).map((x, i) => ({ i: i + 1, n: nm(x.n), p: x.p, m: x.m, me: x.k === aid }));
    if (pos > top) list.push({ i: pos, n: nm(L[pos - 1].n), p: L[pos - 1].p, m: L[pos - 1].m, me: true, gap: true });
    return send(res, 200, { ok: true, cls, total: L.length, pos, list });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
