'use strict';
const { redis, pipeline, send, body, parseCode, nameKey } = require('./_lib');
const MAX_SNAP = 250000, MAX_DETAIL = 40000;
/* the student's page calls this: a heartbeat (who is writing now), and the progress snapshot + result code + detailed report when something changed */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), aid = String(b.aid || '').slice(0, 200);
  if (!aid) return send(res, 400, { error: 'bad_account' });
  try {
    const [name, cls, phone, ts0] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'phone', 'ts']);
    if (!name) return send(res, 404, { error: 'no_account' });
    const now = Date.now(), w = String(b.w || '').slice(0, 40), cmds = [['HSET', 'mf:seen:' + cls, aid, JSON.stringify({ t: now, w })]];
    let status = 'ping', set = [];
    if (typeof b.snap === 'string' && b.snap.length && b.snap.length <= MAX_SNAP) {
      const ts = Math.floor(+b.ts || 0);
      if (ts >= (+ts0 || 0)) { set.push('snap', b.snap, 'ts', String(ts)); status = 'saved'; } else status = 'old';
    }
    if (status !== 'old' && b.code) {
      const x = parseCode(b.code);
      if (x && nameKey(x.name) === nameKey(name)) {
        let det = '';
        if (b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail)) { try { det = JSON.stringify({ c: b.code, d: b.detail }); } catch (e) { det = ''; } if (det.length > MAX_DETAIL) det = ''; }
        set.push('code', b.code); if (det) set.push('det', det);
        cmds.push(['HSET', 'mf:cls:' + cls, aid, JSON.stringify({ n: name, p: phone, c: b.code, d: det ? 1 : (b.keepDet ? 1 : 0) })]);
        status = status === 'old' ? status : 'saved';
      }
    }
    if (set.length) cmds.push(['HSET', 'mf:acc:' + aid].concat(set));
    await pipeline(cmds);
    return send(res, 200, { ok: true, status });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
