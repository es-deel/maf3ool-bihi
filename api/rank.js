'use strict';
const { redis, pipeline, send, body, cfg, eff, same, classRows, rankRows, boardName, seasonBase, BOARD_TOP, deny, hbOf, classData, teamBoard, allBoard, TEAM_BY, ALL_BY, cleanEq } = require('./_lib');
/* the class honour board a student sees (only when the teacher turned it on): computed from the results the students' pages sent.
   POST {aid, sk, mode:'season'|'all'} → {ok, cls, title, motto, by, mode, season, total, pos, me, near, list[], avg, hall[], hidden}
   POST {aid, sk, view:'team'|'all', mode} → the board of the best class / of every student of every class (only when the teacher turned it on).
   POST {t:1, view:'team'|'all', by?, mode?, min?} with the teacher's token → the same boards in full (every class, every student, whatever their settings), for the dashboard. */
const eqOf = j => { try { return cleanEq(JSON.parse(j || '{}')); } catch (e) { return { t: '', f: '' }; } };
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), aid = String(b.aid || '').slice(0, 200), view = b.view === 'team' || b.view === 'all' || b.view === 'museum' ? b.view : 'cls';
  try {
    if (b.t || view !== 'cls') {
      let cls = '', teacher = !!b.t;
      if (teacher) { if (await deny(req, res)) return; }
      else { const [c, sk] = await redis(['HMGET', 'mf:acc:' + aid, 'cls', 'sk']); if (!c || !sk || !same(b.sk || '', sk)) return send(res, 401, { error: 'bad_session' }); cls = c; }
      const g = await cfg(true), h = hbOf(g);
      if (view === 'museum') {   // the museum of heroes: every finished season (the student sees his own class, and the best classes / the school's heroes only if the teacher opened those boards)
        const c = eff(g, cls), ok = teacher || c.board !== 'off' || h.team.on || h.all.on; if (!ok) return send(res, 200, { ok: true, off: true, view });
        const list = (g.boardHall || []).map(s => ({ id: s.id, t: s.t, from: s.from, to: s.to,
          cls: teacher ? s.top || {} : ((s.top || {})[cls] || []).slice(0, 3).map(x => ({ n: boardName(x.n, c.boardNames), sp: x.sp })),
          team: teacher || h.team.on ? (s.team || []).map(x => Object.assign({}, x, { me: x.c === cls })) : [],
          all: teacher || h.all.on ? (s.all || []).map(x => ({ n: boardName(x.n, teacher ? 'full' : h.all.names), c: teacher || h.all.cls ? x.c : '', sp: x.sp })) : [] }));
        return send(res, 200, { ok: true, view, my: cls, list: teacher ? list : list.filter(s => (s.cls && s.cls.length) || s.team.length || s.all.length) });
      }
      const conf = view === 'team' ? h.team : h.all;
      if (!teacher && !conf.on) return send(res, 200, { ok: true, off: true, view });
      if (view === 'cls') return send(res, 400, { error: 'view' });
      const season = g.boardSeason && g.boardSeason.id && b.mode !== 'all' ? g.boardSeason : null, base = season ? await seasonBase() : null, data = await classData();
      const by = teacher && (view === 'team' ? TEAM_BY : ALL_BY).includes(b.by) ? b.by : conf.by;
      const sinfo = season ? { id: season.id, t: season.t, from: season.from } : null;
      if (view === 'team') {
        const min = teacher && b.min ? Math.max(1, Math.min(10, Math.floor(+b.min) || 1)) : conf.min, R = teamBoard(data, by, !!season, base, min), ranked = R.filter(x => !x.pend), mine = R.find(x => x.c === cls);
        const pos = mine ? mine.i : 0, near = pos > 1 ? { c: ranked[pos - 2].c, gap: Math.max(0.1, Math.ceil((ranked[pos - 2].v - mine.v) * 10) / 10), i: pos - 1 } : null;
        return send(res, 200, { ok: true, view, title: conf.title, motto: conf.motto, by, min, on: !!conf.on, mode: season ? 'season' : 'all', season: sinfo, my: cls, pos, near, total: ranked.length, list: R.map(x => Object.assign({}, x, { me: x.c === cls })) });
      }
      const hide = new Set(teacher ? [] : g.boardHide || []), R = allBoard(data, by, !!season, base, hide), top = teacher ? 600 : conf.top, pos = R.findIndex(x => x.k === aid) + 1;
      const shown = R.slice(0, top); if (pos > top) shown.push(R[pos - 1]);
      const aw = await pipeline(shown.map(x => ['HMGET', 'mf:acc:' + x.k, teacher ? 'eq' : 'aw', 'eq']));
      const names = teacher ? 'full' : conf.names, list = shown.map((x, i) => { let ic = '', at = ''; const q = eqOf(aw[i] && aw[i][1]); if (!teacher) try { const a = JSON.parse((aw[i] && aw[i][0]) || '[]')[0]; if (a) { ic = a.ic; at = a.t; } } catch (e) { } return { et: q.t, ef: q.f, i: R.indexOf(x) + 1, n: boardName(x.n, names), c: teacher || conf.cls ? x.c : '', p: x.p, m: x.m, s: x.s, v: x.v, pct: x.pct, sp: x.sp, me: x.k === aid, ic, at, k: teacher ? x.k : undefined }; });
      const near = pos > 1 ? { n: boardName(R[pos - 2].n, names), gap: Math.max(0.1, Math.ceil((R[pos - 2].v - R[pos - 1].v) * 10) / 10), i: pos - 1 } : null;
      return send(res, 200, { ok: true, view, title: conf.title, motto: conf.motto, by, on: !!conf.on, mode: season ? 'season' : 'all', season: sinfo, top, total: R.length, pos, near, list, hidden: !teacher && (g.boardHide || []).includes(aid), showCls: !!conf.cls, my: cls });
    }
    const [cls, sk] = await redis(['HMGET', 'mf:acc:' + aid, 'cls', 'sk']);
    if (!cls || !sk || !same(b.sk || '', sk)) return send(res, 401, { error: 'bad_session' });
    const g = await cfg(), c = eff(g, cls); if (c.board === 'off') return send(res, 200, { ok: true, off: true });
    const hideSet = new Set(g.boardHide || []), season = c.bseason && b.mode !== 'all' ? c.bseason : null;
    const L = await classRows(cls), hidden = hideSet.has(aid);
    const R = rankRows(L.filter(x => !hideSet.has(x.k)), c.boardBy, !!season, season ? await seasonBase() : null);
    const top = BOARD_TOP[c.board] || 5, pos = R.findIndex(x => x.k === aid) + 1;
    const shown = R.slice(0, top); if (pos > top) shown.push(R[pos - 1]);
    const aw = await pipeline(shown.map(x => ['HMGET', 'mf:acc:' + x.k, 'aw', 'eq']));
    const row = (x, i) => { let ic = '', at = ''; const q = eqOf(aw[i] && aw[i][1]); try { const a = JSON.parse((aw[i] && aw[i][0]) || '[]')[0]; if (a) { ic = a.ic; at = a.t; } } catch (e) { } return { et: q.t, ef: q.f, i: R.indexOf(x) + 1, n: boardName(x.n, c.boardNames), p: x.p, m: x.m, s: x.s, v: x.v, pct: x.pct, sp: x.sp, me: x.k === aid, ic, at }; };
    const list = shown.map(row), me = pos ? list.find(x => x.me) : null;
    const near = pos > 1 ? { n: boardName(R[pos - 2].n, c.boardNames), gap: Math.max(0.1, Math.ceil((R[pos - 2].v - R[pos - 1].v) * 10) / 10), i: pos - 1 } : null;
    const avg = R.length ? Math.round(R.reduce((t, x) => t + x.pct, 0) / R.length * 10) / 10 : 0;
    const hall = (g.boardHall || []).map(h => ({ id: h.id, t: h.t, from: h.from, to: h.to, top: ((h.top || {})[cls] || []).slice(0, 3).map(x => ({ n: boardName(x.n, c.boardNames), sp: x.sp })) })).filter(h => h.top.length).slice(0, 4);
    return send(res, 200, { ok: true, cls, title: c.boardTitle, motto: c.boardMotto, by: c.boardBy, mode: season ? 'season' : 'all', season: c.bseason, top, total: R.length, pos, me, near, avg, list, hall, hidden });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
