'use strict';
const { redis, pipeline, send, deny, qs, classes, h2o } = require('./_lib');
/* one student's detailed report (teacher only); served only while it belongs to his newest result code */
module.exports = async (req, res) => {
  if (await deny(req, res)) return;
  const cls = String(qs(req, 'cls') || '').trim();
  if (cls && qs(req, 'dets')) {   // the class file: the compact detailed report of every student of one class (only those that match his newest result code)
    try {
      if (!(await classes()).includes(cls)) return send(res, 404, { error: 'bad_class' });
      const ids = Object.keys(h2o((await redis(['HGETALL', 'mf:cls:' + cls])) || [])), dets = {};
      for (let i = 0; i < ids.length; i += 40) {
        const part = ids.slice(i, i + 40), got = await pipeline(part.map(a => ['HMGET', 'mf:acc:' + a, 'det', 'code', 'aw', 'ce']));
        part.forEach((a, k) => { const [det, code, aw, ce] = got[k] || []; let o = null; try { o = det ? JSON.parse(det) : null; } catch (e) { o = null; } let w = []; try { w = aw ? JSON.parse(aw) : []; } catch (e) { w = []; }
          dets[a] = { d: o && o.c === code ? o.d : null, aw: w.length, ce: ce === '1' ? 1 : 0 }; });
      }
      return send(res, 200, { ok: true, dets });
    } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
  }
  const aid = String(qs(req, 'aid') || '').slice(0, 200);
  if (!aid) return send(res, 400, { error: 'bad_account' });
  try {
    if (qs(req, 'full')) {   // the student's whole file: progress snapshot (challenges, badges, games…) + the teacher's awards
      const [name, snap, aw, ts, bk, bkt, ce] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'snap', 'aw', 'ts', 'bk', 'bkt', 'ce']);
      if (!name) return send(res, 404, { error: 'no_account' });
      let s = null, w = []; try { s = snap ? JSON.parse(snap) : null; } catch (e) { s = null; } try { w = aw ? JSON.parse(aw) : []; } catch (e) { w = []; }
      return send(res, 200, { ok: true, snap: s, aw: w, ts: +ts || 0, bk: bk ? 1 : 0, ce: ce === '1' ? 1 : 0, bkt: +bkt || 0 });
    }
    const [det, code] = await redis(['HMGET', 'mf:acc:' + aid, 'det', 'code']);
    if (!det) return send(res, 404, { error: 'no_detail' });
    let o; try { o = JSON.parse(det); } catch (e) { return send(res, 404, { error: 'no_detail' }); }
    if (!o || o.c !== code) return send(res, 404, { error: 'no_detail' });
    return send(res, 200, { ok: true, detail: o.d });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
