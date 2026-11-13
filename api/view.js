'use strict';
const { redis, send, qs } = require('./_lib');
/* the parent's link: one student's report, by a private token that only the teacher can create */
module.exports = async (req, res) => {
  const t = String(qs(req, 't') || '').replace(/[^0-9a-f]/g, '').slice(0, 40);
  if (t.length < 16) return send(res, 404, { error: 'no_report' });
  try {
    const aid = await redis(['GET', 'mf:vt:' + t]); if (!aid) return send(res, 404, { error: 'no_report' });
    const [name, cls, code, det] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'code', 'det']);
    if (!name || !code) return send(res, 404, { error: 'no_report' });
    let d = null; try { const o = JSON.parse(det || 'null'); if (o && o.c === code) d = o.d; } catch (e) { }
    return send(res, 200, { ok: true, name, cls, code, detail: d });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
