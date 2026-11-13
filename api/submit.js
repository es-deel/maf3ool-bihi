'use strict';
const { parseCode, nameKey, normCls, redis, body, send } = require('./_lib');
const MAX_STUDENTS = 150, TTL = 400 * 24 * 3600, MAX_DETAIL = 40000;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), cls = normCls(b.cls), x = parseCode(b.code);
  if (!cls) return send(res, 400, { error: 'bad_class' });
  if (!x) return send(res, 400, { error: 'bad_code' });
  /* the optional detailed report (what the teacher's page shows); it is stored next to the code and only served while it belongs to the newest code */
  let det = '';
  if (b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail)) { try { det = JSON.stringify({ c: b.code, d: b.detail }); } catch (e) { det = ''; } if (det.length > MAX_DETAIL) det = ''; }
  const key = 'mf:cls:' + cls, dkey = 'mf:det:' + cls, field = nameKey(x.name);
  try {
    const cur = await redis(['HGET', key, field]), old = cur ? parseCode(cur) : null;
    let status;
    if (!old) {
      if ((await redis(['HLEN', key])) >= MAX_STUDENTS) return send(res, 429, { error: 'class_full' });
      await redis(['HSET', key, field, b.code]); status = 'added';
    } else if (cur === b.code) status = 'same';
    else if (x.t > old.t || (x.t === old.t && x.pts > old.pts)) { await redis(['HSET', key, field, b.code]); status = 'updated'; }
    else status = 'old';
    if (status !== 'old') {
      if (det) { await redis(['HSET', dkey, field, det]); await redis(['EXPIRE', dkey, TTL]); }
      await redis(['EXPIRE', key, TTL]);
    }
    return send(res, 200, { ok: true, status });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
