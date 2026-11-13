'use strict';
const { redis, pipeline, send, body, normPhone, h2o } = require('./_lib');
/* sign in with the phone number: returns the saved progress. Several children may share one number: then the student picks his name. */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), phone = normPhone(b.phone);
  if (!phone) return send(res, 400, { error: 'bad_phone' });
  try {
    const list = h2o(await redis(['HGETALL', 'mf:ph:' + phone])), ids = Object.keys(list);
    if (!ids.length) return send(res, 404, { error: 'no_account' });
    let aid = b.aid && list[b.aid] ? b.aid : null;
    if (!aid && ids.length === 1) aid = ids[0];
    if (!aid) return send(res, 200, { ok: true, choose: ids.map(k => { let o = {}; try { o = JSON.parse(list[k]); } catch (e) { } return { aid: k, n: o.n, c: o.c }; }) });
    const [name, cls, snap, ts] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'snap', 'ts']);
    if (!name) return send(res, 404, { error: 'no_account' });
    await redis(['HSET', 'mf:seen:' + cls, aid, JSON.stringify({ t: Date.now() })]);
    return send(res, 200, { ok: true, aid, name, cls, phone, snap: snap || '', ts: +ts || 0 });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
