'use strict';
const { normCls, redis, send, deny, qs } = require('./_lib');
/* one student's detailed report (teacher only) */
module.exports = async (req, res) => {
  if (deny(req, res)) return;
  const cls = normCls(qs(req, 'cls')), k = String(qs(req, 'k') || '').slice(0, 120);
  if (!cls || !k) return send(res, 400, { error: 'bad_class' });
  try {
    const v = await redis(['HGET', 'mf:det:' + cls, k]), cur = await redis(['HGET', 'mf:cls:' + cls, k]);
    if (!v) return send(res, 404, { error: 'no_detail' });
    let o; try { o = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return send(res, 404, { error: 'no_detail' }); }
    if (!o || o.c !== cur) return send(res, 404, { error: 'no_detail' });
    return send(res, 200, { ok: true, detail: o.d });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
