'use strict';
const { parseCode, nameKey, normCls, redis, body, send } = require('./_lib');
const MAX_STUDENTS = 150, TTL = 400 * 24 * 3600;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), cls = normCls(b.cls), x = parseCode(b.code);
  if (!cls) return send(res, 400, { error: 'bad_class' });
  if (!x) return send(res, 400, { error: 'bad_code' });
  const key = 'mf:cls:' + cls, field = nameKey(x.name);
  try {
    const cur = await redis(['HGET', key, field]), old = cur ? parseCode(cur) : null;
    if (!old) {
      if ((await redis(['HLEN', key])) >= MAX_STUDENTS) return send(res, 429, { error: 'class_full' });
      await redis(['HSET', key, field, b.code]); await redis(['EXPIRE', key, TTL]); return send(res, 200, { ok: true, status: 'added' });
    }
    if (cur === b.code) return send(res, 200, { ok: true, status: 'same' });
    if (x.t > old.t || (x.t === old.t && x.pts > old.pts)) { await redis(['HSET', key, field, b.code]); await redis(['EXPIRE', key, TTL]); return send(res, 200, { ok: true, status: 'updated' }); }
    return send(res, 200, { ok: true, status: 'old' });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
