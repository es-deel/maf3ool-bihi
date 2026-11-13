'use strict';
const { redis, send, deny, qs, classes, h2o, cfg } = require('./_lib');
/* the teacher's list: every student of one class (or all classes) with the result code, whether a detailed report exists, and when he was last seen */
module.exports = async (req, res) => {
  if (await deny(req, res)) return;
  try {
    const all = await classes(), want = String(qs(req, 'cls') || 'all').trim(), list = want === 'all' ? all : [want];
    const out = [];
    for (const cls of list) {
      const rows = h2o((await redis(['HGETALL', 'mf:cls:' + cls])) || []), seen = h2o((await redis(['HGETALL', 'mf:seen:' + cls])) || []);
      Object.keys(rows).forEach(aid => { let r = {}, s = {}; try { r = JSON.parse(rows[aid]); } catch (e) { } try { s = JSON.parse(seen[aid] || '{}'); } catch (e) { }
        out.push({ aid, cls, name: r.n || '', phone: r.p || '', code: r.c || '', det: !!r.d, seen: s.t || 0, w: s.w || '' }); });
    }
    return send(res, 200, { ok: true, classes: all, students: out, now: Date.now(), cfg: await cfg(true), user: req.teacher });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
