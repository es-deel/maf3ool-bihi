'use strict';
const { redis, pipeline, send, body, cfg, eff, same, classRows, rankRows, boardName, seasonBase, BOARD_TOP } = require('./_lib');
/* the class honour board a student sees (only when the teacher turned it on): computed from the results the students' pages sent.
   POST {aid, sk, mode:'season'|'all'} → {ok, cls, title, motto, by, mode, season, total, pos, me, near, list[], avg, hall[], hidden} */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), aid = String(b.aid || '').slice(0, 200);
  try {
    const [cls, sk] = await redis(['HMGET', 'mf:acc:' + aid, 'cls', 'sk']);
    if (!cls || !sk || !same(b.sk || '', sk)) return send(res, 401, { error: 'bad_session' });
    const g = await cfg(), c = eff(g, cls); if (c.board === 'off') return send(res, 200, { ok: true, off: true });
    const hideSet = new Set(g.boardHide || []), season = c.bseason && b.mode !== 'all' ? c.bseason : null;
    const L = await classRows(cls), hidden = hideSet.has(aid);
    const R = rankRows(L.filter(x => !hideSet.has(x.k)), c.boardBy, !!season, season ? await seasonBase() : null);
    const top = BOARD_TOP[c.board] || 5, pos = R.findIndex(x => x.k === aid) + 1;
    const shown = R.slice(0, top); if (pos > top) shown.push(R[pos - 1]);
    const aw = await pipeline(shown.map(x => ['HGET', 'mf:acc:' + x.k, 'aw']));
    const row = (x, i) => { let ic = '', at = ''; try { const a = JSON.parse(aw[i] || '[]')[0]; if (a) { ic = a.ic; at = a.t; } } catch (e) { } return { i: R.indexOf(x) + 1, n: boardName(x.n, c.boardNames), p: x.p, m: x.m, s: x.s, v: x.v, pct: x.pct, sp: x.sp, me: x.k === aid, ic, at }; };
    const list = shown.map(row), me = pos ? list.find(x => x.me) : null;
    const near = pos > 1 ? { n: boardName(R[pos - 2].n, c.boardNames), gap: Math.max(0.1, Math.ceil((R[pos - 2].v - R[pos - 1].v) * 10) / 10), i: pos - 1 } : null;
    const avg = R.length ? Math.round(R.reduce((t, x) => t + x.pct, 0) / R.length * 10) / 10 : 0;
    const hall = (g.boardHall || []).map(h => ({ id: h.id, t: h.t, from: h.from, to: h.to, top: ((h.top || {})[cls] || []).slice(0, 3).map(x => ({ n: boardName(x.n, c.boardNames), sp: x.sp })) })).filter(h => h.top.length).slice(0, 4);
    return send(res, 200, { ok: true, cls, title: c.boardTitle, motto: c.boardMotto, by: c.boardBy, mode: season ? 'season' : 'all', season: c.bseason, top, total: R.length, pos, me, near, avg, list, hall, hidden });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
