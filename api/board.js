'use strict';
const crypto = require('crypto');
const { normCls, redis, send } = require('./_lib');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
module.exports = async (req, res) => {
  const want = process.env.TEACHER_KEY;
  if (!want) return send(res, 503, { error: 'no_teacher_key' });
  if (!same(req.headers['x-key'] || '', want)) return send(res, 401, { error: 'bad_key' });
  const cls = normCls((req.query && req.query.cls) || new URL(req.url, 'http://x').searchParams.get('cls'));
  if (!cls) return send(res, 400, { error: 'bad_class' });
  try { const codes = (await redis(['HVALS', 'mf:cls:' + cls])) || []; return send(res, 200, { ok: true, cls, codes }); }
  catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
