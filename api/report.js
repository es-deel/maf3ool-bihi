'use strict';
const { redis, send, deny, qs } = require('./_lib');
/* one student's detailed report (teacher only); served only while it belongs to his newest result code */
module.exports = async (req, res) => {
  if (await deny(req, res)) return;
  const aid = String(qs(req, 'aid') || '').slice(0, 200);
  if (!aid) return send(res, 400, { error: 'bad_account' });
  try {
    if (qs(req, 'full')) {   // the student's whole file: progress snapshot (challenges, badges, games…) + the teacher's awards
      const [name, snap, aw, ts, bk, bkt] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'snap', 'aw', 'ts', 'bk', 'bkt']);
      if (!name) return send(res, 404, { error: 'no_account' });
      let s = null, w = []; try { s = snap ? JSON.parse(snap) : null; } catch (e) { s = null; } try { w = aw ? JSON.parse(aw) : []; } catch (e) { w = []; }
      return send(res, 200, { ok: true, snap: s, aw: w, ts: +ts || 0, bk: bk ? 1 : 0, bkt: +bkt || 0 });
    }
    const [det, code] = await redis(['HMGET', 'mf:acc:' + aid, 'det', 'code']);
    if (!det) return send(res, 404, { error: 'no_detail' });
    let o; try { o = JSON.parse(det); } catch (e) { return send(res, 404, { error: 'no_detail' }); }
    if (!o || o.c !== code) return send(res, 404, { error: 'no_detail' });
    return send(res, 200, { ok: true, detail: o.d });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
