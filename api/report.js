'use strict';
const { redis, send, deny, qs } = require('./_lib');
/* one student's detailed report (teacher only); served only while it belongs to his newest result code */
module.exports = async (req, res) => {
  if (await deny(req, res)) return;
  const aid = String(qs(req, 'aid') || '').slice(0, 200);
  if (!aid) return send(res, 400, { error: 'bad_account' });
  try {
    const [det, code] = await redis(['HMGET', 'mf:acc:' + aid, 'det', 'code']);
    if (!det) return send(res, 404, { error: 'no_detail' });
    let o; try { o = JSON.parse(det); } catch (e) { return send(res, 404, { error: 'no_detail' }); }
    if (!o || o.c !== code) return send(res, 404, { error: 'no_detail' });
    return send(res, 200, { ok: true, detail: o.d });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
