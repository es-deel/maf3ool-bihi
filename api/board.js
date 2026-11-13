'use strict';
const { normCls, redis, send, deny, qs } = require('./_lib');
module.exports = async (req, res) => {
  if (deny(req, res)) return;
  const cls = normCls(qs(req, 'cls'));
  if (!cls) return send(res, 400, { error: 'bad_class' });
  try {
    const flat = (await redis(['HGETALL', 'mf:cls:' + cls])) || [], dk = new Set((await redis(['HKEYS', 'mf:det:' + cls])) || []);
    const items = [];
    for (let i = 0; i + 1 < flat.length; i += 2) items.push({ k: flat[i], code: flat[i + 1], det: dk.has(flat[i]) });
    return send(res, 200, { ok: true, cls, codes: items.map(x => x.code), items });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
